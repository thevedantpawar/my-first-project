"""FastAPI entry point for the Microns control panel."""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app import __version__
from app.config import settings
from app.database import engine, init_db
from app.routers import auth, billing, clinics
from app.schemas import HealthResponse

logging.basicConfig(
    level=getattr(logging, str(settings.log_level).upper(), logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("microns.control")

#: The platform liveness probe, exempt from host checking below.
HEALTH_PATH = "/health"


class HealthExemptTrustedHost(TrustedHostMiddleware):
    """Host checking, minus the platform's own healthcheck.

    Railway probes the healthcheck path from inside its network, with a Host
    header of its choosing rather than the public hostname. Host checking
    answers that probe 400, so the deployment never becomes healthy: it sits in
    "Deploying" until the platform gives up and kills it, while the container is
    in fact serving every real request correctly. Nothing in the deploy log says
    "rejected host" — the request never reaches the application.

    Exempting the probe is safe. ``/health`` is unauthenticated and returns no
    tenant data, and it is already reachable by anyone who uses the correct
    hostname, so nothing new is exposed. Every other path is still checked,
    which is what the middleware is actually for: DNS rebinding and Host-header
    poisoning.

    Listing the platform's healthcheck hostname in ALLOWED_HOSTS would work too,
    until the platform changes it — and then it fails this same silent way.
    """

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope.get("path") == HEALTH_PATH:
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)



@asynccontextmanager
async def lifespan(app: FastAPI):
    # Refuses to boot in production without a master key or a session secret.
    settings.assert_production_ready()

    for warning in settings.startup_warnings():
        logger.warning("STARTUP: %s", warning)

    init_db()
    logger.info(
        "Microns Control Panel v%s ready (env=%s, railway=%s, stripe=%s)",
        __version__,
        settings.environment,
        "configured" if settings.railway_enabled else "not configured",
        "configured" if settings.stripe_enabled else "not configured",
    )
    yield
    logger.info("Shutting down")


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    description="Accounts, billing and per-clinic engine provisioning for Microns.",
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

if settings.is_production and settings.allowed_hosts != ["*"]:
    app.add_middleware(HealthExemptTrustedHost, allowed_hosts=settings.allowed_hosts)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # Unlike the engine's API, this one authenticates with a cookie, so
    # credentials must be allowed — and therefore the origin list must be
    # explicit. A wildcard origin with credentials is rejected by browsers and
    # would be a CSRF hole if it were not.
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
    max_age=600,
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    """Attach a request id, time the request, and set security headers."""
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id
    started = time.perf_counter()

    response = await call_next(request)

    duration_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    if settings.is_production:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    # The query string is never logged: a reset token travels in one.
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

    An exception message can quote the row that caused it, and a row here can
    hold a sealed secret. Clients get a request id to quote at support.
    """
    request_id = getattr(request.state, "request_id", None)
    logger.exception("Unhandled error on %s rid=%s", request.url.path, request_id)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "request_id": request_id},
    )


app.include_router(auth.router)
app.include_router(clinics.router)
app.include_router(billing.router)


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
            "railway": settings.railway_enabled,
            "stripe": settings.stripe_enabled,
            "master_key_configured": bool(settings.master_key),
        },
        warnings=settings.startup_warnings(),
    )


def _web_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "web"


_web_path = _web_dir()
if _web_path.is_dir():
    app.mount("/static", StaticFiles(directory=str(_web_path)), name="static")

    @app.get("/", include_in_schema=False)
    @app.get("/{page}", include_in_schema=False)
    def index(page: str = "") -> FileResponse:
        """Serve the single-page owner UI.

        Routing is client-side, so any unmatched path returns the shell and the
        app decides what to render. API routes are registered above this and
        are matched first.
        """
        return FileResponse(str(_web_path / "index.html"))
