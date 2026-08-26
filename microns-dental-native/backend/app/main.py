"""FastAPI entry point for Microns Dental Native."""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app import __version__
from app.config import settings
from app.database import engine, init_db
from app.routers import appointments, insurance, internal, leads, retention, treatment_plans, voice, webhooks
from app.schemas import HealthResponse

logging.basicConfig(
    level=getattr(logging, str(settings.log_level).upper(), logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("microns")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.assert_production_ready()

    for warning in settings.startup_warnings():
        logger.warning("STARTUP: %s", warning)

    init_db()
    logger.info(
        "Microns Dental Native v%s ready (env=%s, llm=%s, sms=%s, google=%s)",
        __version__, settings.environment,
        "openai" if settings.openai_enabled else "rule-engine",
        "twilio" if settings.twilio_enabled else "dry-run",
        "connected" if settings.google_enabled else "not-authorised",
    )
    yield
    logger.info("Shutting down")


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    description=(
        "HIPAA-aware automation for dental practices: Google Calendar-triggered hygiene "
        "recall, Gmail-approved treatment-plan follow-up, review request & response, "
        "after-hours emergency capture, lead qualification, insurance verification, and an "
        "AI voice agent."
    ),
    lifespan=lifespan,
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
        "%s %s -> %s (%.1fms) rid=%s", request.method, request.url.path, response.status_code, duration_ms, request_id,
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
    return JSONResponse(status_code=500, content={"detail": "Internal server error", "request_id": request_id})


app.include_router(voice.router)
app.include_router(retention.router)
app.include_router(treatment_plans.router)
app.include_router(leads.router)
app.include_router(insurance.router)
app.include_router(webhooks.router)
app.include_router(appointments.router)
app.include_router(internal.router)


def _widget_dir() -> Path:
    if settings.widget_dir:
        return Path(settings.widget_dir)
    return Path(__file__).resolve().parents[2] / "frontend" / "chat-widget"


_widget_path = _widget_dir()
if _widget_path.is_dir():
    app.mount("/widget", StaticFiles(directory=str(_widget_path)), name="widget")
    logger.info("Chat widget served from %s at /widget", _widget_path)
else:
    logger.warning("Chat widget directory not found at %s — /widget is not mounted", _widget_path)


@app.get("/health", response_model=HealthResponse, tags=["health"])
def health() -> HealthResponse:
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
            "openai": settings.openai_enabled,
            "twilio": settings.twilio_enabled,
            "vapi": bool(settings.vapi_webhook_secret),
            "calendly": settings.calendly_enabled,
            "google": settings.google_enabled,
            "encryption_key_configured": bool(settings.encryption_key),
        },
        warnings=settings.startup_warnings(),
    )


@app.get("/", tags=["health"])
def root() -> dict[str, Any]:
    return {
        "service": settings.app_name,
        "version": __version__,
        "modules": {
            "hygiene_recall": "/retention",
            "treatment_plans": "/retention/treatment-plans",
            "reviews": "/retention (trigger-review, review-received)",
            "emergency_capture": "/webhooks/twilio",
            "leads": "/leads",
            "insurance": "/insurance",
            "voice_agent": "/voice",
            "internal_jobs": "/internal",
        },
        "docs": None if settings.is_production else "/docs",
        "widget": "/widget/microns-dental-chat.js",
    }
