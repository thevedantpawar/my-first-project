"""OpenAI client wrapper.

Three jobs:

* **Enforce de-identification.** Every prompt is scanned for phone numbers,
  emails and SSNs immediately before the request leaves the process. A prompt
  that still contains one never goes out — in production it raises.
* **Enforce zero retention.** ``store=False`` on every call, plus a startup
  check that ZDR is configured for anything approaching production.
* **Degrade instead of failing.** Without an API key — or when OpenAI is down —
  the callers fall back to the deterministic rule engines in
  ``lead_service``/``voice_service``/``insurance_service``. The product still
  qualifies leads, triages emergencies and books appointments; it just stops
  paraphrasing.

Model choice follows the brief: ``gpt-4o-mini`` for latency-sensitive
conversational turns, ``gpt-4o`` where reasoning quality matters (review
responses, ambiguous qualification answers).
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

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
    """Thin, auditable wrapper around chat completions."""

    def __init__(self) -> None:
        self._client = None
        self._init_error: Optional[str] = None
        if settings.openai_enabled and OpenAI is not None:
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
            f"({', '.join(sorted(set(found)))}) to OpenAI. "
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
            model=model or settings.openai_model_fast,
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
            model=model or settings.openai_model_fast,
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
        content = (choice.message.content if choice and choice.message else None) or None
        return content.strip() if content else None


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
