"""Application settings.

Everything configurable lives here, loaded from environment variables (see
``.env.example``). Nothing in this module may log a secret.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Annotated, List, Optional

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

logger = logging.getLogger(__name__)

#: Placeholder shipped in .env.example. Treated as "unset" so a freshly copied
#: env file still boots in development instead of crashing on a bad Fernet key.
PLACEHOLDER_ENCRYPTION_KEY = "generate-with-fernet-key-gen"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- App ---------------------------------------------------------------
    environment: str = "development"
    log_level: str = "INFO"
    app_name: str = "Microns AI System"
    cors_origins: Annotated[List[str], NoDecode] = ["http://localhost:3000", "http://localhost:8000"]
    allowed_hosts: Annotated[List[str], NoDecode] = ["*"]

    # --- Database ----------------------------------------------------------
    database_url: str = "postgresql://microns:password@postgres:5432/microns_db"
    redis_url: str = "redis://redis:6379/0"
    db_echo: bool = False

    # --- Crypto ------------------------------------------------------------
    encryption_key: Optional[str] = None
    encryption_keys_old: Annotated[List[str], NoDecode] = []
    fingerprint_secret: str = "change-me-to-a-long-random-string"
    internal_api_token: str = "change-me-to-a-long-random-string"
    #: Shared secret for clinic-staff endpoints (dashboard, at-risk patients).
    staff_api_token: Optional[str] = None

    # --- Language model ----------------------------------------------------
    #: Which vendor writes the agents' language: ``openai``, ``gemini``, or
    #: ``none`` to force the deterministic rule engine. Flow control is
    #: unaffected either way — the model never decides what to ask or how to
    #: score, so switching vendors changes wording, not outcomes.
    llm_provider: str = "openai"

    # --- OpenAI ------------------------------------------------------------
    openai_api_key: Optional[str] = None
    openai_org_id: Optional[str] = None
    openai_model_fast: str = "gpt-4o-mini"
    openai_model_smart: str = "gpt-4o"
    openai_zero_retention: bool = True
    openai_timeout_seconds: float = 20.0

    # --- Google Gemini -----------------------------------------------------
    gemini_api_key: Optional[str] = None
    #: Defaults verified against the live API: flash-lite answers short
    #: structured prompts reliably, and 3.6-flash is what the endpoint itself
    #: recommends for the heavier ones. Both are overridable.
    gemini_model_fast: str = "gemini-3.1-flash-lite"
    gemini_model_smart: str = "gemini-3.6-flash"
    gemini_api_base: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_timeout_seconds: float = 30.0
    #: Gemini 3.x models spend "thinking" tokens against ``maxOutputTokens``,
    #: so a 200-token budget sized for a non-thinking model returns a truncated
    #: answer. This headroom is added to every request; the caller's own limit
    #: still bounds the visible reply.
    gemini_thinking_headroom_tokens: int = 1024
    #: Sent as ``thinkingConfig.thinkingBudget`` when set. Leave unset: not
    #: every model accepts it, and 3.6-flash rejects a budget of 0 outright.
    gemini_thinking_budget: Optional[int] = None

    # --- Twilio ------------------------------------------------------------
    twilio_account_sid: Optional[str] = None
    twilio_auth_token: Optional[str] = None
    twilio_phone_number: Optional[str] = None
    twilio_validate_signature: bool = True
    #: Whether SMS copy may name the treatment ("your Botox appointment").
    #: Off by default — texts land on lock screens.
    sms_include_treatment_details: bool = False

    # --- VAPI --------------------------------------------------------------
    vapi_api_key: Optional[str] = None
    vapi_webhook_secret: Optional[str] = None
    vapi_assistant_id: Optional[str] = None
    clinic_transfer_number: Optional[str] = None

    # --- Booking system ----------------------------------------------------
    booking_system_type: str = "generic"
    booking_api_key: Optional[str] = None
    booking_api_secret: Optional[str] = None
    booking_api_base_url: Optional[str] = None
    booking_calendar_id: Optional[str] = None

    # --- Google Calendar ---------------------------------------------------
    #: Set BOOKING_SYSTEM_TYPE=google to book into a Google Calendar.
    #:
    #: A refresh token rather than a service account, so the same setup works
    #: for a Workspace clinic calendar and for an owner's ordinary Google
    #: account. Obtain it once through the OAuth consent flow for the scope
    #: https://www.googleapis.com/auth/calendar — see docs/V4.md.
    google_calendar_id: Optional[str] = None          # "primary", or a calendar address
    google_oauth_client_id: Optional[str] = None
    google_oauth_client_secret: Optional[str] = None
    google_oauth_refresh_token: Optional[str] = None

    # --- Calendly ----------------------------------------------------------
    calendly_api_key: Optional[str] = None
    calendly_event_type_uri: Optional[str] = None
    calendly_scheduling_url: str = "https://calendly.com/your-clinic/consultation"

    # --- Clinic profile ----------------------------------------------------
    clinic_name: str = "Radiance Med Spa"
    clinic_timezone: str = "America/New_York"
    clinic_phone: Optional[str] = None
    clinic_booking_url: str = "https://your-clinic.com/book"
    clinic_review_url: str = "https://g.page/r/your-google-review-link/review"
    clinic_open_hour: int = 9
    clinic_close_hour: int = 18
    appointment_slot_minutes: int = 30

    # --- Service pricing ---------------------------------------------------
    #: JSON file mapping a service key to a ``booking_value`` in dollars — the
    #: value the clinic books one appointment of that service at. Without it
    #: the built-in defaults in ``pricing_service`` apply. Prices recorded this
    #: way are reported as *expected* value, never as collected revenue.
    service_price_list_path: Optional[str] = None

    # --- Demo mode ---------------------------------------------------------
    #: Serve the seeded Glow Aesthetics dataset and badge the console as a
    #: demonstration. Refused in production; see ``demo_service``.
    demo_mode: bool = False

    #: Seed the demonstration clinic at startup when demo mode is on and
    #: nothing is seeded yet. Exists for hosted demos, where there is no shell
    #: to run ``python -m app.cli demo seed`` in. Inherits every guard the CLI
    #: has: it is a no-op in production, and a no-op when data already exists.
    demo_seed_on_boot: bool = False

    # --- Retention tuning --------------------------------------------------
    reactivation_days: int = 45
    review_request_delay_days: int = 5
    no_show_credit_amount: int = 50

    # --- n8n ---------------------------------------------------------------
    #: Base URL for n8n webhook triggers. Set to the ``/webhook-test`` variant
    #: while building workflows in the editor.
    n8n_webhook_base_url: str = "http://n8n:5678/webhook"

    # --- Filesystem --------------------------------------------------------
    widget_dir: Optional[str] = None
    console_dir: Optional[str] = None
    voice_prompt_dir: Optional[str] = None

    # ------------------------------------------------------------------ #
    # Validators
    # ------------------------------------------------------------------ #
    @field_validator("cors_origins", "allowed_hosts", "encryption_keys_old", mode="before")
    @classmethod
    def _split_csv(cls, value):
        """Accept both a JSON list and a plain comma-separated env string."""
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("encryption_key", mode="before")
    @classmethod
    def _blank_placeholder(cls, value):
        if not value or value == PLACEHOLDER_ENCRYPTION_KEY:
            return None
        return value

    @field_validator("environment", mode="before")
    @classmethod
    def _normalise_environment(cls, value):
        return str(value or "development").strip().lower()

    @field_validator("llm_provider", mode="before")
    @classmethod
    def _normalise_provider(cls, value):
        provider = str(value or "openai").strip().lower()
        return provider if provider in {"openai", "gemini", "none"} else "openai"

    # ------------------------------------------------------------------ #
    # Derived values
    # ------------------------------------------------------------------ #
    @property
    def is_production(self) -> bool:
        return self.environment in {"production", "prod", "staging"}

    @property
    def sqlalchemy_url(self) -> str:
        """Normalise the DSN to a driver SQLAlchemy 2.x can actually load.

        ``.env.example`` ships the canonical ``postgresql://`` form, but the
        image installs psycopg 3 rather than psycopg2, so the driver has to be
        named explicitly.
        """
        url = self.database_url
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+psycopg://", 1)
        if url.startswith("postgres://"):
            return url.replace("postgres://", "postgresql+psycopg://", 1)
        return url

    @property
    def is_sqlite(self) -> bool:
        return self.sqlalchemy_url.startswith("sqlite")

    @property
    def twilio_enabled(self) -> bool:
        return bool(self.twilio_account_sid and self.twilio_auth_token and self.twilio_phone_number)

    @property
    def openai_enabled(self) -> bool:
        """Whether OpenAI specifically is usable — key present and not the placeholder."""
        return bool(self.openai_api_key and not self.openai_api_key.startswith("sk-..."))

    @property
    def gemini_enabled(self) -> bool:
        return bool(self.gemini_api_key)

    @property
    def llm_enabled(self) -> bool:
        """Whether *any* model is configured for the selected provider."""
        if self.llm_provider == "openai":
            return self.openai_enabled
        if self.llm_provider == "gemini":
            return self.gemini_enabled
        return False

    @property
    def llm_vendor(self) -> str:
        """The vendor name recorded on every LLM audit row."""
        return self.llm_provider if self.llm_enabled else "rule-engine"

    @property
    def llm_model_fast(self) -> str:
        return self.gemini_model_fast if self.llm_provider == "gemini" else self.openai_model_fast

    @property
    def llm_model_smart(self) -> str:
        return self.gemini_model_smart if self.llm_provider == "gemini" else self.openai_model_smart

    @property
    def llm_zero_retention(self) -> bool:
        """Whether the selected provider is under a no-retention arrangement.

        OpenAI has one this code can assert: ``store=False`` on every call plus
        ZDR on the org. The Gemini Developer API has no per-request equivalent
        and Google offers a BAA on Vertex AI, not on this endpoint — so this is
        False for Gemini, and the health payload and console say so rather than
        inheriting a claim that was only ever true of OpenAI.
        """
        if self.llm_provider == "openai":
            return self.openai_zero_retention
        return False

    @property
    def calendly_enabled(self) -> bool:
        return bool(self.calendly_api_key and self.calendly_event_type_uri)

    @property
    def google_calendar_enabled(self) -> bool:
        """All three OAuth values present. Two out of three is not connected."""
        return bool(
            self.google_oauth_client_id
            and self.google_oauth_client_secret
            and self.google_oauth_refresh_token
        )

    def startup_warnings(self) -> List[str]:
        """Deployment problems worth shouting about at boot.

        Returned rather than logged so ``main.py`` owns the log format and the
        test suite can assert on them.
        """
        warnings: List[str] = []
        if not self.encryption_key:
            warnings.append(
                "ENCRYPTION_KEY is not set — an ephemeral key is in use and encrypted "
                "data will be unreadable after restart. Run `python -m app.cli gen-key`."
            )
        if self.fingerprint_secret.startswith("change-me"):
            warnings.append("FINGERPRINT_SECRET is still the default value.")
        if self.internal_api_token.startswith("change-me"):
            warnings.append("INTERNAL_API_TOKEN is still the default value.")
        if not self.llm_enabled:
            key_name = "GEMINI_API_KEY" if self.llm_provider == "gemini" else "OPENAI_API_KEY"
            reason = (
                "LLM_PROVIDER is 'none'"
                if self.llm_provider == "none"
                else f"{key_name} is not set"
            )
            warnings.append(
                f"{reason} — lead qualification and voice replies fall back to the "
                "deterministic rule engine."
            )
        if not self.twilio_enabled:
            warnings.append(
                "Twilio is not configured — SMS is recorded and audited but not delivered."
            )
        if self.is_production and self.llm_provider == "openai" and not self.openai_zero_retention:
            warnings.append(
                "OPENAI_ZERO_RETENTION is false in a production environment — this is a "
                "HIPAA finding. Enable ZDR on the OpenAI org."
            )
        if self.is_production and self.llm_provider == "gemini" and self.gemini_enabled:
            warnings.append(
                "LLM_PROVIDER is 'gemini' in a production environment. Prompts are "
                "de-identified before they are sent, but the Gemini Developer API "
                "offers no zero-retention setting and Google's BAA covers Vertex AI, "
                "not this endpoint — so this configuration is not BAA-covered."
            )
        if self.is_production and self.allowed_hosts == ["*"]:
            warnings.append("ALLOWED_HOSTS is '*' in production.")
        return warnings

    def assert_production_ready(self) -> None:
        """Hard failures that must never be allowed to run against real PHI."""
        if not self.is_production:
            return
        problems = []
        if not self.encryption_key:
            problems.append("ENCRYPTION_KEY")
        if self.fingerprint_secret.startswith("change-me"):
            problems.append("FINGERPRINT_SECRET")
        if self.internal_api_token.startswith("change-me"):
            problems.append("INTERNAL_API_TOKEN")
        if problems:
            raise RuntimeError(
                "Refusing to start in "
                f"{self.environment}: unset or default secrets: {', '.join(problems)}"
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
