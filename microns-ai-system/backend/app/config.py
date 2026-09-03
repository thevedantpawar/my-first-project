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

    # --- OpenAI ------------------------------------------------------------
    openai_api_key: Optional[str] = None
    openai_org_id: Optional[str] = None
    openai_model_fast: str = "gpt-4o-mini"
    openai_model_smart: str = "gpt-4o"
    openai_zero_retention: bool = True
    openai_timeout_seconds: float = 20.0

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
        return bool(self.openai_api_key and not self.openai_api_key.startswith("sk-..."))

    @property
    def calendly_enabled(self) -> bool:
        return bool(self.calendly_api_key and self.calendly_event_type_uri)

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
        if not self.openai_enabled:
            warnings.append(
                "OPENAI_API_KEY is not set — lead qualification and voice replies fall "
                "back to the deterministic rule engine."
            )
        if not self.twilio_enabled:
            warnings.append(
                "Twilio is not configured — SMS is recorded and audited but not delivered."
            )
        if self.is_production and not self.openai_zero_retention:
            warnings.append(
                "OPENAI_ZERO_RETENTION is false in a production environment — this is a "
                "HIPAA finding. Enable ZDR on the OpenAI org."
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
