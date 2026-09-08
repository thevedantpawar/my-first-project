"""Request and response shapes.

Response models never carry a sealed secret. The one endpoint that reveals a
clinic's encryption key has its own explicit model, so no secret can reach a
client by being added to a shared schema.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
class SignupRequest(BaseModel):
    account_name: str = Field(min_length=1, max_length=200)
    name: Optional[str] = Field(default=None, max_length=200)
    email: EmailStr
    password: str = Field(min_length=1, max_length=1024)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=1024)


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=1024)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(min_length=1, max_length=1024)


class UserResponse(BaseModel):
    id: str
    email: str
    name: Optional[str]
    is_owner: bool
    account_id: str
    account_name: str
    is_staff: bool


class SessionResponse(BaseModel):
    authenticated: bool
    user: Optional[UserResponse] = None


# --------------------------------------------------------------------------- #
# Clinics
# --------------------------------------------------------------------------- #
class ClinicCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    timezone: str = Field(default="America/New_York", max_length=64)
    contact_email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, max_length=40)
    booking_url: Optional[str] = Field(default=None, max_length=500)
    review_url: Optional[str] = Field(default=None, max_length=500)
    open_hour: int = Field(default=9, ge=0, le=23)
    close_hour: int = Field(default=18, ge=1, le=24)


class ClinicUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    timezone: Optional[str] = Field(default=None, max_length=64)
    contact_email: Optional[EmailStr] = None
    phone: Optional[str] = Field(default=None, max_length=40)
    booking_url: Optional[str] = Field(default=None, max_length=500)
    review_url: Optional[str] = Field(default=None, max_length=500)
    open_hour: Optional[int] = Field(default=None, ge=0, le=23)
    close_hour: Optional[int] = Field(default=None, ge=1, le=24)


class ProvisioningEventResponse(BaseModel):
    step: str
    outcome: str
    sequence: int
    message: Optional[str]
    duration_ms: Optional[int]
    created_at: datetime


class ClinicResponse(BaseModel):
    """A clinic as the owner sees it. Carries no secret, by construction."""

    id: str
    name: str
    slug: str
    status: str
    status_detail: Optional[str]
    timezone: str
    contact_email: Optional[str]
    phone: Optional[str]
    engine_url: Optional[str]
    console_url: Optional[str]
    integrations: Dict[str, Any]
    key_backup_confirmed: bool
    provisioned_at: Optional[datetime]
    created_at: datetime


class ClinicDetailResponse(ClinicResponse):
    provisioning: List[ProvisioningEventResponse] = []


class EncryptionKeyResponse(BaseModel):
    """The one response that carries a secret.

    Its own model, deliberately, so a field can never be added to the shared
    clinic schema and start leaking this by accident. Every retrieval is
    audited.
    """

    clinic_id: str
    encryption_key: str
    warning: str


# --------------------------------------------------------------------------- #
# Billing
# --------------------------------------------------------------------------- #
class SubscriptionResponse(BaseModel):
    plan: str
    status: str
    is_entitled: bool
    clinic_limit: int
    clinics_used: int
    trial_ends_at: Optional[datetime]
    current_period_end: Optional[datetime]


class CheckoutRequest(BaseModel):
    plan: str = Field(default="starter", max_length=40)


class CheckoutResponse(BaseModel):
    checkout_url: str


# --------------------------------------------------------------------------- #
# Health
# --------------------------------------------------------------------------- #
class HealthResponse(BaseModel):
    status: str
    environment: str
    version: str
    database: str
    integrations: Dict[str, bool]
    warnings: List[str]
