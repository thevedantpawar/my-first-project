"""Control-panel settings.

Everything configurable lives here, loaded from environment variables (see
``.env.example``). Nothing in this module may log a secret.

The control panel is a higher-value target than any single clinic's engine: it
holds the escrowed encryption key for every clinic, and that key decrypts that
clinic's PHI. The startup checks below are correspondingly strict — this
process refuses to run in production without them.
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
PLACEHOLDER_MASTER_KEY = "generate-with-python-m-app-cli-gen-key"


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
    app_name: str = "Microns Control Panel"
    public_base_url: str = "http://localhost:8080"
    cors_origins: Annotated[List[str], NoDecode] = ["http://localhost:8080"]
    allowed_hosts: Annotated[List[str], NoDecode] = ["*"]

    # --- Database ----------------------------------------------------------
    database_url: str = "postgresql://microns:password@localhost:5432/microns_control"
    db_echo: bool = False

    # --- Crypto ------------------------------------------------------------
    #: Fernet key wrapping every per-clinic secret held in this database.
    #:
    #: This is the most sensitive value in the entire product. It unwraps each
    #: clinic's ENCRYPTION_KEY, which in turn decrypts that clinic's PHI. Back
    #: it up outside this system, rotate it deliberately, and never log it.
    master_key: Optional[str] = None
    #: Previous master keys, newest first. Lets a rotated key still unwrap
    #: secrets sealed before the rotation.
    master_keys_old: Annotated[List[str], NoDecode] = []

    #: Signs session cookies. Rotating it logs everybody out, which is the
    #: correct response to suspecting it leaked.
    session_secret: str = "change-me-to-a-long-random-string"
    session_max_age_seconds: int = 60 * 60 * 12
    session_cookie_name: str = "microns_session"

    # --- Passwords ---------------------------------------------------------
    #: Argon2id parameters. The defaults follow OWASP's 2024 guidance; raising
    #: them is safe (existing hashes carry their own parameters and are
    #: re-hashed on next login), lowering them is not.
    argon2_time_cost: int = 3
    argon2_memory_cost_kib: int = 65536
    argon2_parallelism: int = 4
    password_min_length: int = 12

    # --- Railway (provisioning target) -------------------------------------
    railway_api_token: Optional[str] = None
    railway_api_url: str = "https://backboard.railway.com/graphql/v2"
    #: Workspace that new clinic projects are created in.
    railway_workspace_id: Optional[str] = None
    #: Git repository and branch the engine is deployed from.
    engine_repo: str = "thevedantpawar/my-first-project"
    engine_branch: str = "main"
    #: Path within the repo that holds the engine's Dockerfile.
    engine_root_directory: str = "microns-ai-system/backend"
    #: Postgres image used for each clinic's database.
    clinic_postgres_image: str = "postgres:17"
    #: Size in GB of the volume attached to each clinic's Postgres. A clinic
    #: database without a volume loses every record on the next restart.
    clinic_volume_size_gb: int = 5
    railway_timeout_seconds: float = 30.0

    # --- Stripe ------------------------------------------------------------
    stripe_api_key: Optional[str] = None
    stripe_webhook_secret: Optional[str] = None
    stripe_price_id_starter: Optional[str] = None
    stripe_price_id_growth: Optional[str] = None
    stripe_trial_days: int = 14

    # --- Engine defaults pushed to each clinic -----------------------------
    #: LLM vendor configured on a newly provisioned engine. Defaults to none —
    #: the deterministic rule engine — because neither vendor is BAA-covered
    #: until the operator arranges it, and a clinic should not silently start
    #: sending prompts to an uncovered endpoint on day one.
    default_llm_provider: str = "none"
    default_openai_api_key: Optional[str] = None
    default_gemini_api_key: Optional[str] = None

    # ------------------------------------------------------------------ #
    # Validators
    # ------------------------------------------------------------------ #
    @field_validator("cors_origins", "allowed_hosts", "master_keys_old", mode="before")
    @classmethod
    def _split_csv(cls, value):
        """Accept both a JSON list and a plain comma-separated env string.

        pydantic-settings tries ``json.loads`` on any ``List[str]`` field before
        validators run, so these fields carry ``NoDecode`` and are split here.
        """
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("master_key", mode="before")
    @classmethod
    def _blank_placeholder(cls, value):
        if not value or value == PLACEHOLDER_MASTER_KEY:
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
        """Normalise the DSN to a driver SQLAlchemy 2.x can actually load."""
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
    def railway_enabled(self) -> bool:
        return bool(self.railway_api_token and self.railway_workspace_id)

    @property
    def stripe_enabled(self) -> bool:
        return bool(self.stripe_api_key and self.stripe_webhook_secret)

    def startup_warnings(self) -> List[str]:
        """Deployment problems worth shouting about at boot."""
        warnings: List[str] = []
        if not self.master_key:
            warnings.append(
                "MASTER_KEY is not set — an ephemeral key is in use and every "
                "stored clinic secret becomes unreadable after restart. Run "
                "`python -m app.cli gen-key`."
            )
        if self.session_secret.startswith("change-me"):
            warnings.append("SESSION_SECRET is still the default value.")
        if not self.railway_enabled:
            warnings.append(
                "Railway is not configured — clinics can be created but not "
                "provisioned. Set RAILWAY_API_TOKEN and RAILWAY_WORKSPACE_ID."
            )
        if not self.stripe_enabled:
            warnings.append(
                "Stripe is not configured — signup works but nothing is billed. "
                "Set STRIPE_API_KEY and STRIPE_WEBHOOK_SECRET."
            )
        if self.is_production and self.allowed_hosts == ["*"]:
            warnings.append("ALLOWED_HOSTS is '*' in production.")
        return warnings

    def assert_production_ready(self) -> None:
        """Hard failures that must never be allowed to run in production.

        The engine has an equivalent check. This one is stricter because a
        compromise here is every clinic at once rather than one.
        """
        if not self.is_production:
            return
        problems = []
        if not self.master_key:
            problems.append("MASTER_KEY")
        if self.session_secret.startswith("change-me"):
            problems.append("SESSION_SECRET")
        if problems:
            raise RuntimeError(
                "Refusing to start in "
                f"{self.environment}: unset or default secrets: {', '.join(problems)}"
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
