"""PHI de-identification for anything sent to a third-party model.

Nothing in this system sends raw PHI to OpenAI. Text is run through a
:class:`DeidentificationContext` first, which swaps identifiers for stable
tokens (``[PATIENT_123]``, ``[PHONE_1]``, ``[EMAIL_1]``). The model reasons over
tokens; the response is re-identified on the way back so the patient still
hears their own name.

This implements the identifier-stripping half of the HIPAA Safe Harbor method
(§164.514(b)(2)) for the *outbound prompt* specifically. It is a strong
technical control, not a substitute for a BAA and Zero Data Retention on the
vendor account — run all three.
"""

from __future__ import annotations

import re
from typing import Dict, Iterable, List, Optional, Tuple

# Order matters: the first pattern to match a span owns it. Emails are matched
# before phone numbers because an address can contain a run of digits, and SSNs
# before phones because both are digit groups with separators.
_PATTERNS: List[Tuple[str, re.Pattern]] = [
    ("EMAIL", re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")),
    ("SSN", re.compile(r"\b\d{3}-\d{2}-\d{4}\b")),
    (
        "PHONE",
        re.compile(
            r"(?:\+?1[\s.\-]?)?"          # optional country code
            r"\(?\b\d{3}\)?[\s.\-]?"      # area code, optionally parenthesised
            r"\d{3}[\s.\-]?\d{4}\b"       # subscriber number
        ),
    ),
    ("MRN", re.compile(r"\b(?:MRN|mrn)[:\s#]*([A-Za-z0-9\-]{5,})\b")),
    ("DATE", re.compile(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b")),
    ("ADDRESS", re.compile(
        r"\b\d{1,5}\s+[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*\s+"
        r"(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way)\b\.?"
    )),
]

#: Phrases people use to volunteer a name in chat or on a call.
#:
#: The cue itself is case-insensitive, the captured name is not: requiring a
#: capital letter is what stops "call me at 555…" from tokenising "at" as a
#: name. Names typed in lowercase are caught by ``_NAME_CUES_EXPLICIT`` below,
#: where the cue is unambiguous enough that whatever follows is a name.
_NAME_CUES = re.compile(
    r"(?i:\b(?:my name is|i am|i'm|this is|it's|name's|call me))\s+"
    r"([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z'\-]{1,20}){0,2})"
)

_NAME_CUES_EXPLICIT = re.compile(
    r"(?i:\b(?:my name is|name is|name's))\s+"
    r"([A-Za-z][\w'\-]{1,20}(?:\s+(?!and\b|but\b|the\b|my\b|i\b)[A-Za-z][\w'\-]{1,20})?)",
    re.IGNORECASE,
)

_TOKEN_RE = re.compile(r"\[[A-Z]+_\d+\]")


class DeidentificationContext:
    """Bidirectional token map for one conversation or one request.

    Tokens are stable within a context, so the model sees the same
    ``[PATIENT_1]`` across every turn and can refer back to them coherently.

    ::

        ctx = DeidentificationContext(patient_uuid=patient.id)
        ctx.register_name(patient.name)
        safe = ctx.deidentify("Hi, this is Jane Doe on 555-123-4567")
        # -> "Hi, this is [PATIENT_1] on [PHONE_1]"
        reply = ctx.reidentify(model_output)
    """

    def __init__(self, patient_uuid: Optional[str] = None) -> None:
        self.patient_uuid = str(patient_uuid) if patient_uuid else None
        self._token_to_value: Dict[str, str] = {}
        self._value_to_token: Dict[str, str] = {}
        self._counters: Dict[str, int] = {}
        self._registered_names: List[str] = []

    # ------------------------------------------------------------------ #
    # Token management
    # ------------------------------------------------------------------ #
    def _token_for(self, kind: str, value: str) -> str:
        key = f"{kind}:{value.strip().lower()}"
        existing = self._value_to_token.get(key)
        if existing:
            return existing
        self._counters[kind] = self._counters.get(kind, 0) + 1
        token = f"[{kind}_{self._counters[kind]}]"
        self._value_to_token[key] = token
        self._token_to_value[token] = value
        return token

    def register_name(self, name: Optional[str]) -> Optional[str]:
        """Pre-register a name known from the database.

        Names cannot be found by pattern the way an email can, so any name the
        caller already holds must be declared before :meth:`deidentify` runs.
        """
        if not name or not str(name).strip():
            return None
        name = str(name).strip()
        token = self._token_for("PATIENT", name)
        for part in [name] + name.split():
            if len(part) > 2 and part.lower() not in self._registered_names:
                self._registered_names.append(part.lower())
        # Longest first so "Jane Doe" wins over "Jane".
        self._registered_names.sort(key=len, reverse=True)
        self._value_to_token.setdefault(f"PATIENT:{name.lower()}", token)
        return token

    def register_value(self, kind: str, value: Optional[str]) -> Optional[str]:
        """Pre-register any identifier (phone, email) with a stable token."""
        if not value:
            return None
        return self._token_for(kind.upper(), str(value))

    # ------------------------------------------------------------------ #
    # The two operations that matter
    # ------------------------------------------------------------------ #
    def deidentify(self, text: Optional[str]) -> str:
        """Replace identifiers in ``text`` with tokens."""
        if not text:
            return ""
        result = str(text)

        # 1. Structured identifiers first. A name pass run before this one
        #    would shred "jane@example.com" into "[PATIENT_1]@example.com",
        #    leaving the domain — and the address shape — in the prompt.
        for kind, pattern in _PATTERNS:
            def _replace(match: re.Match, kind=kind) -> str:
                value = match.group(0)
                if _TOKEN_RE.fullmatch(value):
                    return value
                return self._token_for(kind, value)

            result = pattern.sub(_replace, result)

        # 2. Names registered from the database, longest match first.
        for name in self._registered_names:
            pattern = re.compile(rf"\b{re.escape(name)}\b", re.IGNORECASE)
            match = pattern.search(result)
            while match:
                token = self._token_for("PATIENT", match.group(0))
                result = result[: match.start()] + token + result[match.end():]
                match = pattern.search(result)

        # 3. Names the speaker volunteers mid-conversation.
        def _replace_cue(match: re.Match) -> str:
            captured = match.group(1)
            if _TOKEN_RE.search(captured):
                return match.group(0)
            token = self._token_for("PATIENT", captured)
            self.register_name(captured)
            return match.group(0).replace(captured, token)

        result = _NAME_CUES.sub(_replace_cue, result)
        result = _NAME_CUES_EXPLICIT.sub(_replace_cue, result)

        return result

    def reidentify(self, text: Optional[str]) -> str:
        """Put the real values back into a model response."""
        if not text:
            return ""
        result = str(text)
        for token, value in self._token_to_value.items():
            result = result.replace(token, value)
        return result

    # ------------------------------------------------------------------ #
    @property
    def tokens(self) -> Dict[str, str]:
        return dict(self._token_to_value)

    def token_count(self) -> int:
        return len(self._token_to_value)

    def deidentify_many(self, texts: Iterable[Optional[str]]) -> List[str]:
        return [self.deidentify(text) for text in texts]


def deidentify(
    text: Optional[str],
    *,
    names: Optional[Iterable[str]] = None,
    patient_uuid: Optional[str] = None,
) -> Tuple[str, DeidentificationContext]:
    """One-shot de-identification.

    Returns the safe text plus the context needed to re-identify the response::

        safe, ctx = deidentify(message, names=[patient.name])
        reply = ctx.reidentify(llm.complete(safe))
    """
    context = DeidentificationContext(patient_uuid=patient_uuid)
    for name in names or []:
        context.register_name(name)
    return context.deidentify(text), context


def contains_identifiers(text: Optional[str]) -> List[str]:
    """Return the identifier kinds still present in ``text``.

    Used as an outbound tripwire in :mod:`app.services.llm`: if this returns
    anything for a prompt about to leave the building, the prompt is rejected.
    Names are not detectable this way — this catches the mechanical mistakes
    (a phone number spliced into a template, a raw email in a summary).
    """
    if not text:
        return []
    found: List[str] = []
    for kind, pattern in _PATTERNS:
        if kind in {"DATE", "ADDRESS"}:
            # Too noisy to block on: appointment dates are legitimate prompt
            # content once names and contact details are gone.
            continue
        if pattern.search(str(text)):
            found.append(kind)
    return found


def scrub(text: Optional[str]) -> str:
    """Irreversibly redact identifiers. For log lines and error messages.

    Use this where nothing will ever need re-identification — it throws the
    mapping away instead of keeping it in memory.
    """
    safe, _ = deidentify(text)
    return safe


__all__ = ["DeidentificationContext", "deidentify", "scrub", "contains_identifiers"]
