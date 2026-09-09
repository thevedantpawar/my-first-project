"""Provider selection: OpenAI, Gemini, or the rule engine.

The point of these tests is that switching vendors changes *wording only*.
Flow control, scoring, the safety gates and the PHI guard are provider-blind,
and the system must never describe a vendor's retention terms as better than
they are.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.config import Settings
from app.services import llm as llm_module
from app.services.llm import LLMService, PHILeakError, reset_llm


@pytest.fixture(autouse=True)
def _reset():
    reset_llm()
    yield
    reset_llm()


def _settings(**overrides) -> Settings:
    base = {
        "environment": "test",
        "encryption_key": "0Wl8Vv3s5rN7yQzXk2hJ4pT6dF8gB1cA3eR5tY7uI9o=",
        "fingerprint_secret": "test-fingerprint-secret",
        "internal_api_token": "test-internal-token",
    }
    base.update(overrides)
    return Settings(**base)


# --------------------------------------------------------------------- #
# Selection
# --------------------------------------------------------------------- #
def test_gemini_is_enabled_by_its_own_key():
    config = _settings(llm_provider="gemini", gemini_api_key="test-key")
    assert config.llm_enabled is True
    assert config.llm_vendor == "gemini"
    assert config.llm_model_fast == "gemini-3.1-flash-lite"


def test_an_openai_key_does_not_enable_gemini():
    """Selecting a provider means that provider, not whichever key exists."""
    config = _settings(llm_provider="gemini", openai_api_key="sk-real-looking-key")
    assert config.llm_enabled is False
    assert config.llm_vendor == "rule-engine"


def test_provider_none_forces_the_rule_engine():
    config = _settings(llm_provider="none", gemini_api_key="k", openai_api_key="sk-k")
    assert config.llm_enabled is False


def test_an_unknown_provider_falls_back_to_openai():
    assert _settings(llm_provider="banana").llm_provider == "openai"


def test_provider_name_is_case_and_space_insensitive():
    assert _settings(llm_provider="  GEMINI ").llm_provider == "gemini"


# --------------------------------------------------------------------- #
# Retention claims
# --------------------------------------------------------------------- #
def test_gemini_is_never_reported_as_zero_retention():
    """The Gemini Developer API has no ZDR switch, so the flag stays False."""
    config = _settings(
        llm_provider="gemini", gemini_api_key="k", openai_zero_retention=True
    )
    assert config.llm_zero_retention is False


def test_openai_keeps_its_zero_retention_claim():
    config = _settings(llm_provider="openai", openai_api_key="sk-k", openai_zero_retention=True)
    assert config.llm_zero_retention is True


def test_production_gemini_raises_a_compliance_warning():
    config = _settings(
        environment="production",
        llm_provider="gemini",
        gemini_api_key="k",
        encryption_key="0Wl8Vv3s5rN7yQzXk2hJ4pT6dF8gB1cA3eR5tY7uI9o=",
    )
    warnings = " ".join(config.startup_warnings())
    assert "not BAA-covered" in warnings
    assert "Vertex AI" in warnings


def test_health_reports_the_provider_without_claiming_retention(client):
    body = client.get("/health").json()
    assert body["llm"]["provider"] == "openai"  # the test env default
    assert body["llm"]["enabled"] is False
    assert set(body["integrations"]) >= {"openai", "gemini"}
    # integrations stays a flag map for anything already consuming it
    assert all(isinstance(value, bool) for value in body["integrations"].values())


# --------------------------------------------------------------------- #
# The Gemini request
# --------------------------------------------------------------------- #
class _Recorder:
    """Captures the outgoing request and returns a scripted response."""

    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status
        self.captured = {}

    def __call__(self, url, *, json, headers, timeout):
        self.captured = {"url": url, "json": json, "headers": headers, "timeout": timeout}
        return httpx.Response(
            self.status, json=self.payload, request=httpx.Request("POST", url)
        )


def _gemini_service(monkeypatch, recorder, **overrides):
    config = _settings(llm_provider="gemini", gemini_api_key="test-key", **overrides)
    monkeypatch.setattr(llm_module, "settings", config)
    monkeypatch.setattr(llm_module.httpx, "post", recorder)
    return LLMService(), config


def _ok(text):
    return {
        "candidates": [
            {"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}
        ]
    }


def test_gemini_completion_returns_parsed_json(monkeypatch):
    recorder = _Recorder(_ok('{"budget_range": "1000-2000"}'))
    service, _ = _gemini_service(monkeypatch, recorder)

    result = service.complete_json(system="You map budgets.", user="about two grand", purpose="test")

    assert result == {"budget_range": "1000-2000"}
    assert recorder.captured["url"].endswith(
        "/models/gemini-3.1-flash-lite:generateContent"
    )
    assert recorder.captured["json"]["generationConfig"]["responseMimeType"] == "application/json"
    assert recorder.captured["json"]["systemInstruction"]["parts"][0]["text"] == "You map budgets."


def test_the_key_travels_in_a_header_not_the_url(monkeypatch):
    """A key in a query string ends up in every log between here and Google."""
    recorder = _Recorder(_ok("hello"))
    service, _ = _gemini_service(monkeypatch, recorder)
    service.complete_text(system="s", user="u", purpose="test")

    assert recorder.captured["headers"]["x-goog-api-key"] == "test-key"
    assert "test-key" not in recorder.captured["url"]
    assert "key=" not in recorder.captured["url"]


def test_thinking_headroom_is_added_to_the_output_budget(monkeypatch):
    """A 3.x model spends thinking tokens before it writes anything."""
    recorder = _Recorder(_ok("hi"))
    service, _ = _gemini_service(monkeypatch, recorder, gemini_thinking_headroom_tokens=1024)
    service.complete_text(system="s", user="u", purpose="test", max_tokens=400)

    assert recorder.captured["json"]["generationConfig"]["maxOutputTokens"] == 1424


def test_thinking_budget_is_omitted_unless_configured(monkeypatch):
    """3.6-flash rejects a budget of 0, so it is never sent uninvited."""
    recorder = _Recorder(_ok("hi"))
    service, _ = _gemini_service(monkeypatch, recorder)
    service.complete_text(system="s", user="u", purpose="test")

    assert "thinkingConfig" not in recorder.captured["json"]["generationConfig"]

    recorder2 = _Recorder(_ok("hi"))
    service2, _ = _gemini_service(monkeypatch, recorder2, gemini_thinking_budget=0)
    service2.complete_text(system="s", user="u", purpose="test")

    assert recorder2.captured["json"]["generationConfig"]["thinkingConfig"] == {
        "thinkingBudget": 0
    }


def test_an_http_error_degrades_to_the_rule_engine(monkeypatch):
    recorder = _Recorder({"error": {"message": "quota"}}, status=429)
    service, _ = _gemini_service(monkeypatch, recorder)

    assert service.complete_text(system="s", user="u", purpose="test") is None


def test_a_blocked_prompt_degrades_to_the_rule_engine(monkeypatch):
    """Safety filters return no candidate at all."""
    recorder = _Recorder({"promptFeedback": {"blockReason": "SAFETY"}})
    service, _ = _gemini_service(monkeypatch, recorder)

    assert service.complete_json(system="s", user="u", purpose="test") is None


def test_a_reply_that_was_all_thinking_degrades_rather_than_truncating(monkeypatch):
    recorder = _Recorder(
        {"candidates": [{"content": {"parts": []}, "finishReason": "MAX_TOKENS"}]}
    )
    service, _ = _gemini_service(monkeypatch, recorder)

    assert service.complete_json(system="s", user="u", purpose="test") is None


def test_non_json_from_a_json_call_degrades(monkeypatch):
    """Some models prepend prose despite responseMimeType."""
    recorder = _Recorder(_ok("Here is the JSON you asked for: {...}"))
    service, _ = _gemini_service(monkeypatch, recorder)

    assert service.complete_json(system="s", user="u", purpose="test") is None


def test_a_timeout_degrades_to_the_rule_engine(monkeypatch):
    def _timeout(*args, **kwargs):
        raise httpx.ConnectTimeout("too slow")

    service, _ = _gemini_service(monkeypatch, _timeout)
    assert service.complete_text(system="s", user="u", purpose="test") is None


# --------------------------------------------------------------------- #
# The PHI guard is provider-blind
# --------------------------------------------------------------------- #
def test_the_phi_guard_still_blocks_on_the_gemini_path(monkeypatch):
    """Switching vendors must not open a hole in the de-identification check."""
    recorder = _Recorder(_ok("hi"))
    service, config = _gemini_service(monkeypatch, recorder, environment="production")
    assert config.is_production

    with pytest.raises(PHILeakError):
        service.complete_text(
            system="You are an assistant.",
            user="Call Jane back on 555-123-4567",
            purpose="test",
        )

    # Nothing was sent.
    assert recorder.captured == {}


def test_the_guard_names_the_vendor_the_prompt_was_headed_for(monkeypatch):
    recorder = _Recorder(_ok("hi"))
    service, _ = _gemini_service(monkeypatch, recorder, environment="production")

    with pytest.raises(PHILeakError) as excinfo:
        service.complete_text(system="s", user="email jane@example.com", purpose="test")

    assert "gemini" in str(excinfo.value)
