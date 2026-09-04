"""FastAPI entry point for the Microns AI system."""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app import __version__
from app.config import settings
from app.database import engine, init_db
from app.routers import appointments, console, internal, leads, retention, voice, webhooks
from app.schemas import HealthResponse

logging.basicConfig(
    level=getattr(logging, str(settings.log_level).upper(), logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("microns")


def _seed_demo_if_requested() -> None:
    """Load the demonstration clinic on boot, for hosted demos.

    A demo deployed to a platform has no shell to run the seeding command in,
    so the flag exists to do it at startup instead. It changes nothing about
    the safety model — ``demo_service.seed`` still refuses outright in
    production — and it will not run twice: an already-seeded database is left
    exactly as it is, so a restart never stacks a second clinic on the first
    or resets whatever a prospect did during a demo.

    Failures are logged and swallowed. A demo that fails to seed should serve
    an empty console, which the banner explains, rather than refuse to boot.
    """
    if not settings.demo_seed_on_boot:
        return

    from app.database import SessionLocal
    from app.services import demo_service

    db = SessionLocal()
    try:
        state = demo_service.demo_state(db)
        if state["seeded"]:
            logger.info("DEMO_SEED_ON_BOOT: %s already seeded, leaving it alone", state["clinic"])
            return
        counts = demo_service.seed(db)
        logger.info("DEMO_SEED_ON_BOOT: seeded %s", counts)
    except demo_service.DemoModeRefused as exc:
        logger.warning("DEMO_SEED_ON_BOOT ignored: %s", exc)
    except Exception:
        logger.exception("DEMO_SEED_ON_BOOT failed; the console will show an empty demo")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Refuses to boot in production with default or missing secrets.
    settings.assert_production_ready()

    for warning in settings.startup_warnings():
        logger.warning("STARTUP: %s", warning)

    init_db()
    _seed_demo_if_requested()
    logger.info(
        "Microns AI System v%s ready (env=%s, booking=%s, llm=%s, sms=%s)",
        __version__,
        settings.environment,
        settings.booking_system_type,
        f"{settings.llm_provider}:{settings.llm_model_fast}" if settings.llm_enabled else "rule-engine",
        "twilio" if settings.twilio_enabled else "dry-run",
    )
    yield
    logger.info("Shutting down")


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    description=(
        "HIPAA-aware automation for med spas: AI voice agent, patient retention, "
        "and lead qualification."
    ),
    lifespan=lifespan,
    # The interactive docs expose every schema in the system. Fine in
    # development, off by default in production.
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

if settings.is_production and settings.allowed_hosts != ["*"]:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "X-Staff-Token", "X-Internal-Token", "X-Vapi-Secret"],
    max_age=600,
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    """Attach a request id, time the request, and set security headers.

    The access log records the path and status, never the query string or body
    — a query string can carry a phone number.
    """
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id
    started = time.perf_counter()

    response = await call_next(request)

    duration_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    if settings.is_production:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    logger.info(
        "%s %s -> %s (%.1fms) rid=%s",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
        request_id,
    )
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Log the traceback, return an opaque error.

    An exception message can quote the row that caused it, and that row can be
    PHI. Clients get a request id to quote at support instead.
    """
    request_id = getattr(request.state, "request_id", None)
    logger.exception("Unhandled error on %s rid=%s", request.url.path, request_id)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "request_id": request_id},
    )


app.include_router(voice.router)
app.include_router(retention.router)
app.include_router(leads.router)
app.include_router(webhooks.router)
app.include_router(appointments.router)
app.include_router(internal.router)
app.include_router(console.router)


def _console_dir() -> Path:
    """Where the owner console's static files live.

    Shipped inside ``backend/`` so it is present in the Docker image without
    changing the build context. ``CONSOLE_DIR`` overrides it for a deployment
    that serves the console from somewhere else.
    """
    if settings.console_dir:
        return Path(settings.console_dir)
    return Path(__file__).resolve().parents[1] / "console"


def _widget_dir() -> Path:
    if settings.widget_dir:
        return Path(settings.widget_dir)
    return Path(__file__).resolve().parents[2] / "frontend" / "chat-widget"


_widget_path = _widget_dir()
if _widget_path.is_dir():
    # Serves the embeddable snippet: <script src="…/widget/microns-chat.js">
    app.mount("/widget", StaticFiles(directory=str(_widget_path)), name="widget")
    logger.info("Chat widget served from %s at /widget", _widget_path)
else:
    logger.warning("Chat widget directory not found at %s — /widget is not mounted", _widget_path)


_console_path = _console_dir()
if _console_path.is_dir():
    # The console is a static single-page app. It talks to the same API as
    # every other client, with a staff token the operator supplies at sign-in.
    app.mount("/console/static", StaticFiles(directory=str(_console_path)), name="console")
    logger.info("Owner console served from %s at /console", _console_path)

    @app.get("/console", include_in_schema=False)
    @app.get("/console/", include_in_schema=False)
    def console_index():
        return FileResponse(_console_path / "index.html")

else:  # pragma: no cover - only when the console is deliberately not deployed
    logger.warning("Console directory not found at %s — /console is not mounted", _console_path)


@app.get("/health", response_model=HealthResponse, tags=["health"])
def health() -> HealthResponse:
    """Liveness plus a readable integration summary."""
    database = "ok"
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:
        database = f"error: {type(exc).__name__}"

    return HealthResponse(
        status="ok" if database == "ok" else "degraded",
        environment=settings.environment,
        version=__version__,
        database=database,
        integrations={
            # Kept for existing consumers of this payload; it still means
            # exactly what it always did — OpenAI specifically.
            "openai": settings.openai_enabled,
            "gemini": settings.gemini_enabled,
            "twilio": settings.twilio_enabled,
            "vapi": bool(settings.vapi_webhook_secret),
            "calendly": settings.calendly_enabled,
            "google_calendar": settings.google_calendar_enabled,
            "encryption_key_configured": bool(settings.encryption_key),
        },
        llm={
            "provider": settings.llm_provider,
            "enabled": settings.llm_enabled,
            "model_fast": settings.llm_model_fast,
            "model_smart": settings.llm_model_smart,
            # False for Gemini: that endpoint has no zero-retention setting.
            "zero_retention": settings.llm_zero_retention,
        },
        warnings=settings.startup_warnings(),
    )


@app.get("/", tags=["health"])
def root() -> dict[str, Any]:
    return {
        "service": settings.app_name,
        "version": __version__,
        "modules": {
            "voice_agent": "/voice",
            "retention": "/retention",
            "leads": "/leads",
            "appointments": "/api/appointments",
            "webhooks": "/webhooks",
            "internal": "/internal",
        },
        "console": "/console",
        "docs": None if settings.is_production else "/docs",
        "widget": "/widget/microns-chat.js",
    }
