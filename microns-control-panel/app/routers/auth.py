"""Sign-up, sign-in, sign-out and password lifecycle."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import current_user, current_user_optional, get_audit
from app.models.user import User
from app.ratelimit import login_limiter, reset_limiter, signup_limiter
from app.schemas import (
    LoginRequest,
    PasswordChangeRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    SessionResponse,
    SignupRequest,
    UserResponse,
)
from app.services import accounts, sessions
from app.services.audit import AuditAction, AuditLogger
from app.services.passwords import PasswordPolicyError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_response(user: User) -> UserResponse:
    account = user.account
    return UserResponse(
        id=str(user.id),
        email=user.email,
        name=user.name,
        is_owner=user.is_owner,
        account_id=str(user.account_id),
        account_name=account.name if account else "",
        is_staff=bool(account.is_staff) if account else False,
    )


def _start_session(response: Response, user: User) -> None:
    token = sessions.issue(str(user.id), str(user.session_epoch))
    response.set_cookie(value=token, **sessions.cookie_kwargs())


@router.post("/signup", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def signup(
    payload: SignupRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    audit: AuditLogger = Depends(get_audit),
) -> SessionResponse:
    """Create an account and sign the owner in."""
    signup_limiter.check(request)

    if not accounts.signup_allowed(db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sign-up is closed. Ask the account owner to add you.",
        )

    try:
        _, user = accounts.create_account(
            db,
            account_name=payload.account_name,
            email=payload.email,
            password=payload.password,
            name=payload.name,
        )
    except PasswordPolicyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except accounts.SignupError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    audit.log(AuditAction.SIGNUP, user=user)
    db.commit()

    _start_session(response, user)
    return SessionResponse(authenticated=True, user=_user_response(user))


@router.post("/login", response_model=SessionResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    audit: AuditLogger = Depends(get_audit),
) -> SessionResponse:
    """Sign in.

    Limited per address and per IP: one host must not be able to spray many
    accounts, and a botnet must not be able to grind one.
    """
    email = accounts.normalise_email(payload.email)
    login_limiter.check(request, key=f"email:{email}")
    login_limiter.check(request)

    user = accounts.authenticate(db, email=email, password=payload.password)
    if user is None:
        audit.log(AuditAction.LOGIN_FAILED, outcome="denied", actor_email=email)
        db.commit()
        # One message for every failure. Saying "no such account" would turn
        # this endpoint into a list of which clinics are customers.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email or password is incorrect.",
        )

    audit.log(AuditAction.LOGIN, user=user)
    db.commit()

    _start_session(response, user)
    return SessionResponse(authenticated=True, user=_user_response(user))


@router.post("/logout", response_model=SessionResponse)
def logout(
    response: Response,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user_optional),
    audit: AuditLogger = Depends(get_audit),
) -> SessionResponse:
    """Sign out of this browser.

    Succeeds whether or not a valid session was presented — a sign-out that
    can fail leaves people staring at a page that will not let them leave.
    """
    if user is not None:
        audit.log(AuditAction.LOGOUT, user=user)
        db.commit()

    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
    )
    return SessionResponse(authenticated=False)


@router.get("/session", response_model=SessionResponse)
def read_session(user: User | None = Depends(current_user_optional)) -> SessionResponse:
    """Who, if anyone, is signed in. Cheap enough for the UI to poll on load."""
    if user is None:
        return SessionResponse(authenticated=False)
    return SessionResponse(authenticated=True, user=_user_response(user))


@router.post("/password/reset-request", status_code=status.HTTP_202_ACCEPTED)
def request_password_reset(
    payload: PasswordResetRequest,
    request: Request,
    db: Session = Depends(get_db),
    audit: AuditLogger = Depends(get_audit),
) -> dict:
    """Begin a password reset.

    Always reports the same thing. An address with no account gets the same
    202 and the same wording as one with an account, because the difference
    would be a membership oracle.
    """
    reset_limiter.check(request)

    result = accounts.begin_password_reset(db, email=payload.email)
    if result is not None:
        user, token = result
        audit.log(AuditAction.PASSWORD_RESET_REQUESTED, user=user)
        db.commit()
        reset_url = f"{settings.public_base_url.rstrip('/')}/reset?token={token}"
        # Delivery is not wired up yet. The link is logged so a reset can be
        # completed from the server logs in the meantime — and it is logged at
        # WARNING precisely so this is visible rather than quietly forgotten.
        logger.warning(
            "Password reset requested for %s. Email delivery is not configured; "
            "the link is: %s",
            user.email,
            reset_url,
        )

    return {"detail": "If that address has an account, a reset link is on its way."}


@router.post("/password/reset")
def confirm_password_reset(
    payload: PasswordResetConfirm,
    db: Session = Depends(get_db),
    audit: AuditLogger = Depends(get_audit),
) -> dict:
    """Complete a password reset and sign the user out everywhere."""
    try:
        user = accounts.complete_password_reset(
            db, token=payload.token, new_password=payload.password
        )
    except PasswordPolicyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That reset link is invalid or has expired. Request a new one.",
        )

    audit.log(AuditAction.PASSWORD_CHANGED, user=user, details={"via": "reset"})
    db.commit()
    return {"detail": "Password changed. Sign in with your new password."}


@router.post("/password/change")
def change_password(
    payload: PasswordChangeRequest,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    audit: AuditLogger = Depends(get_audit),
) -> dict:
    """Change your own password.

    Bumps the session epoch, which signs out every other browser. This one gets
    a fresh cookie so the person doing it is not logged out mid-action.
    """
    try:
        ok = accounts.change_password(
            db,
            user=user,
            current_password=payload.current_password,
            new_password=payload.new_password,
        )
    except PasswordPolicyError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    if not ok:
        audit.log_denied("wrong_current_password", actor_email=user.email)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Your current password is incorrect.",
        )

    audit.log(AuditAction.PASSWORD_CHANGED, user=user, details={"via": "change"})
    db.commit()
    db.refresh(user)

    _start_session(response, user)
    return {"detail": "Password changed. Other devices have been signed out."}
