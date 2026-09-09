"""Language-model client. One wrapper, two vendors.

Three jobs, unchanged by which vendor is selected:

* **Enforce de-identification.** Every prompt is scanned for phone numbers,
  emails and SSNs immediately before the request leaves the process. A prompt
  that still contains one never goes out — in production it raises.
* **Minimise retention where the vendor allows it.** OpenAI gets
  ``store=False`` on every call plus the ZDR startup check. The Gemini
  Developer API has no per-request equivalent, so nothing here pretends
  otherwise: ``settings.llm_zero_retention`` reports False for Gemini and the
  health payload and console repeat that rather than inheriting OpenAI's claim.
* **Degrade instead of failing.** Without an API key — or when the vendor is
  down, rate-limited, or returns something unparseable — the callers fall back
  to the deterministic rule engines in ``lead_service``/``voice_service``. The
  product still books appointments and scores leads; it just stops
  paraphrasing.

``LLM_PROVIDER`` selects the vendor. Model choice follows the same shape on
both: a fast model for latency-sensitive conversational turns, a stronger one
where reasoning quality matters (review responses, ambiguous qualification
answers).

The Gemini path is written against the REST endpoint with ``httpx``, which is
already a dependency, rather than adding an SDK for one POST.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

import httpx

from app.config import settings
from app.services.deidentify import contains_identifiers
from app.services.hipaa_audit import HIPAAAuditLogger

logger = logging.getLogger(__name__)

try:  # pragma: no cover - exercised implicitly by the container build
    from openai import OpenAI
    from openai import APIError, APITimeoutError, RateLimitError
except ImportError:  # pragma: no cover
    OpenAI = None  # type: ignore[assignment]
    APIError = APITimeoutError = RateLimitError = Exception  # type: ignore[misc,assignment]


class PHILeakError(RuntimeError):
    """Raised when a prompt still carries identifiers at send time."""


class LLMService:
    """Thin, auditable wrapper around a vendor's completion endpoint."""

    def __init__(self) -> None:
        self._client = None
        self._init_error: Optional[str] = None
        self.provider = settings.llm_provider if settings.llm_enabled else "none"

        if self.provider == "openai" and OpenAI is not None:
            try:
                self._client = OpenAI(
                    api_key=settings.openai_api_key,
                    organization=settings.openai_org_id or None,
                    timeout=settings.openai_timeout_seconds,
                    max_retries=2,
                )
            except Exception as exc:  # pragma: no cover - configuration error
                self._init_error = str(exc)
                logger.error("OpenAI client failed to initialise: %s", exc)
        elif self.provider == "gemini":
            # No client object to build: the Gemini path is one POST per call,
            # so the "client" is the key being present.
            self._client = "gemini"

    @property
    def available(self) -> bool:
        return self._client is not None

    # ------------------------------------------------------------------ #
    # Guards
    # ------------------------------------------------------------------ #
    @staticmethod
    def _assert_deidentified(*parts: Optional[str]) -> None:
        found: list[str] = []
        for part in parts:
            found.extend(contains_identifiers(part))
        if not found:
            return
        message = (
            "Refusing to send a prompt containing identifiers "
            f"({', '.join(sorted(set(found)))}) to {settings.llm_provider}. "
            "Run it through app.services.deidentify first."
        )
        if settings.is_production:
            raise PHILeakError(message)
        # In development this is a loud warning rather than a hard stop, so a
        # developer sees the offending code path instead of a 500 with no clue.
        logger.error("PHI GUARD: %s", message)

    # ------------------------------------------------------------------ #
    # Completions
    # ------------------------------------------------------------------ #
    def complete_json(
        self,
        *,
        system: str,
        user: str,
        purpose: str,
        model: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: int = 600,
        audit: Optional[HIPAAAuditLogger] = None,
        patient_uuid: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        """Structured completion using ``response_format={"type":"json_object"}``.

        Returns ``None`` whenever the model is unavailable or misbehaves, which
        is the caller's signal to use its rule-based path.
        """
        raw = self._complete(
            system=system,
            user=user,
            purpose=purpose,
            model=model or settings.llm_model_fast,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=True,
            audit=audit,
            patient_uuid=patient_uuid,
        )
        if raw is None:
            return None
        try:
            parsed = json.loads(raw)
        except (TypeError, ValueError):
            logger.warning("LLM returned non-JSON despite json_object mode (purpose=%s)", purpose)
            return None
        return parsed if isinstance(parsed, dict) else None

    def complete_text(
        self,
        *,
        system: str,
        user: str,
        purpose: str,
        model: Optional[str] = None,
        temperature: float = 0.5,
        max_tokens: int = 400,
        audit: Optional[HIPAAAuditLogger] = None,
        patient_uuid: Optional[str] = None,
    ) -> Optional[str]:
        return self._complete(
            system=system,
            user=user,
            purpose=purpose,
            model=model or settings.llm_model_fast,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=False,
            audit=audit,
            patient_uuid=patient_uuid,
        )

    def _complete(
        self,
        *,
        system: str,
        user: str,
        purpose: str,
        model: str,
        temperature: float,
        max_tokens: int,
        json_mode: bool,
        audit: Optional[HIPAAAuditLogger],
        patient_uuid: Optional[str],
    ) -> Optional[str]:
        self._assert_deidentified(system, user)

        if audit is not None:
            audit.log_llm_request(
                patient_uuid,
                purpose=purpose,
                model=model,
                deidentified=True,
                token_count=(len(system) + len(user)) // 4,  # rough estimate, no tokenizer dep
            )

        if not self.available:
            logger.debug("LLM unavailable (purpose=%s); caller will use fallback logic", purpose)
            return None

        if self.provider == "gemini":
            content = self._complete_gemini(
                system=system,
                user=user,
                purpose=purpose,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                json_mode=json_mode,
            )
        else:
            content = self._complete_openai(
                system=system,
                user=user,
                purpose=purpose,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                json_mode=json_mode,
            )
        return content.strip() if content else None

    # ------------------------------------------------------------------ #
    # Vendors
    # ------------------------------------------------------------------ #
    def _complete_openai(
        self,
        *,
        system: str,
        user: str,
        purpose: str,
        model: str,
        temperature: float,
        max_tokens: int,
        json_mode: bool,
    ) -> Optional[str]:
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": temperature,
            "max_tokens": max_tokens,
            # Zero-retention: do not let OpenAI persist this exchange.
            "store": False,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        try:
            response = self._client.chat.completions.create(**kwargs)  # type: ignore[union-attr]
        except (APITimeoutError, RateLimitError) as exc:
            logger.warning("OpenAI transient failure (purpose=%s): %s", purpose, type(exc).__name__)
            return None
        except APIError as exc:
            logger.error("OpenAI API error (purpose=%s): %s", purpose, type(exc).__name__)
            return None
        except Exception as exc:  # pragma: no cover - defensive
            logger.error("Unexpected OpenAI failure (purpose=%s): %s", purpose, type(exc).__name__)
            return None

        choice = response.choices[0] if response.choices else None
        return (choice.message.content if choice and choice.message else None) or None

    def _complete_gemini(
        self,
        *,
        system: str,
        user: str,
        purpose: str,
        model: str,
        temperature: float,
        max_tokens: int,
        json_mode: bool,
    ) -> Optional[str]:
        """One ``generateContent`` call.

        Two Gemini-specific details are handled here and nowhere else:

        * **Thinking tokens count against the output budget.** A 3.x model can
          spend a few hundred of them before writing a character, so a limit
          sized for a non-thinking model comes back ``MAX_TOKENS`` with a
          half-written answer. The configured headroom is added on top of the
          caller's limit.
        * **The key goes in a header, never the query string.** A key in the
          URL lands in every proxy and access log between here and Google.
        """
        generation: dict[str, Any] = {
            "temperature": temperature,
            "maxOutputTokens": max_tokens + max(settings.gemini_thinking_headroom_tokens, 0),
        }
        if json_mode:
            generation["responseMimeType"] = "application/json"
        if settings.gemini_thinking_budget is not None:
            generation["thinkingConfig"] = {"thinkingBudget": settings.gemini_thinking_budget}

        payload = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": generation,
        }
        url = f"{settings.gemini_api_base.rstrip('/')}/models/{model}:generateContent"

        try:
            response = httpx.post(
                url,
                json=payload,
                headers={
                    "x-goog-api-key": settings.gemini_api_key or "",
                    "Content-Type": "application/json",
                },
                timeout=settings.gemini_timeout_seconds,
            )
        except httpx.TimeoutException:
            logger.warning("Gemini timeout (purpose=%s, model=%s)", purpose, model)
            return None
        except httpx.HTTPError as exc:
            logger.error("Gemini transport error (purpose=%s): %s", purpose, type(exc).__name__)
            return None

        if response.status_code != 200:
            # Status only. A Gemini error body can quote the prompt back, and
            # the prompt is the one thing that must never reach a log.
            logger.error(
                "Gemini API error (purpose=%s, model=%s): HTTP %s",
                purpose,
                model,
                response.status_code,
            )
            return None

        try:
            body = response.json()
        except ValueError:
            logger.error("Gemini returned a non-JSON envelope (purpose=%s)", purpose)
            return None

        candidates = body.get("candidates") or []
        if not candidates:
            # Safety filters return no candidate at all.
            logger.warning(
                "Gemini returned no candidate (purpose=%s, reason=%s)",
                purpose,
                (body.get("promptFeedback") or {}).get("blockReason"),
            )
            return None

        candidate = candidates[0]
        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(part.get("text", "") for part in parts)

        if candidate.get("finishReason") == "MAX_TOKENS" and not text.strip():
            logger.warning(
                "Gemini spent its whole budget thinking (purpose=%s, model=%s); "
                "raise GEMINI_THINKING_HEADROOM_TOKENS if this recurs",
                purpose,
                model,
            )
            return None

        return text or None


_service: Optional[LLMService] = None


def get_llm() -> LLMService:
    global _service
    if _service is None:
        _service = LLMService()
    return _service


def reset_llm() -> None:
    """Test hook."""
    global _service
    _service = None


__all__ = ["LLMService", "get_llm", "reset_llm", "PHILeakError"]
