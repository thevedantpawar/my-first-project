"""Pydantic v2 request/response models.

Response models are the boundary where PHI stops. Anything defined here as a
patient-facing or staff-facing payload carries UUIDs, masked names and
categories — never a raw phone number or email, unless the endpoint exists
specifically to hand a confirmation back to the person it belongs to.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


# --------------------------------------------------------------------- #
# Shared
# --------------------------------------------------------------------- #
class ActionResult(BaseModel):
    status: str
    detail: Optional[str] = None
    data: dict[str, Any] = Field(default_factory=dict)


class HealthResponse(BaseModel):
    status: str
    environment: str
    version: str
    database: str
    #: Booleans only, so existing consumers can keep treating it as a flag map.
    integrations: dict[str, bool]
    #: Which language model is in use and what its retention terms are. Its own
    #: field rather than a string smuggled into ``integrations``.
    llm: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------- #
# Appointments
# --------------------------------------------------------------------- #
class AppointmentCreate(BaseModel):
    phone: str = Field(min_length=7, max_length=32)
    service: str = Field(min_length=1, max_length=120)
    scheduled_for: datetime
    name: Optional[str] = Field(default=None, max_length=200)
    email: Optional[str] = Field(default=None, max_length=200)
    duration_minutes: int = 30
    provider: Optional[str] = None
    source: str = "staff"
    sms_consent: bool = True
    notes: Optional[str] = None
    #: What the clinic is charging for this appointment, in cents. Optional —
    #: when omitted the clinic's service price list supplies an expected value
    #: instead, and the console labels it as such.
    price_cents: Optional[int] = Field(default=None, ge=0)


class AppointmentOut(BaseModel):
    """De-identified appointment view. Safe for dashboards and n8n."""

    model_config = ConfigDict(from_attributes=True)

    appointment_id: UUID
    patient_uuid: UUID
    service: str
    provider: Optional[str] = None
    scheduled_for: datetime
    duration_minutes: int
    status: str
    source: str


class AppointmentStatusUpdate(BaseModel):
    status: Literal["pending", "confirmed", "completed", "cancelled", "no_show", "rescheduled"]
    reason: Optional[str] = None


# --------------------------------------------------------------------- #
# Retention
# --------------------------------------------------------------------- #
class ReminderRequest(BaseModel):
    appointment_id: UUID
    kind: Literal["24h", "2h"] = "24h"


class TriggerReviewRequest(BaseModel):
    appointment_id: Optional[UUID] = None
    patient_uuid: Optional[UUID] = None
    force: bool = False


class ReviewReceived(BaseModel):
    appointment_id: UUID
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    review_text: Optional[str] = Field(default=None, max_length=4000)


class RetentionEventIn(BaseModel):
    event_type: str
    patient_uuid: Optional[UUID] = None
    appointment_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None
    channel: str = "sms"
    metadata: dict[str, Any] = Field(default_factory=dict)


class PatientAtRisk(BaseModel):
    patient_uuid: UUID
    display_name: str
    days_since_last_visit: Optional[int]
    last_visit_at: Optional[datetime]
    reactivation_sent_at: Optional[datetime]
    marketing_consent: bool


# --------------------------------------------------------------------- #
# Leads
# --------------------------------------------------------------------- #
TreatmentInterest = Literal["botox", "fillers", "laser", "facial", "peel", "other"]
BudgetRange = Literal["0-500", "500-1000", "1000-2000", "2000+"]
Timeline = Literal["asap", "1-2_weeks", "1_month", "browsing"]


class ChatMessage(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    session_id: Optional[str] = Field(default=None, max_length=64)
    source: Literal["website_chat", "sms", "phone", "referral"] = "website_chat"

    @field_validator("message")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class ChatReply(BaseModel):
    session_id: str
    reply: str
    options: list[str] = Field(default_factory=list)
    #: Which qualification slot the reply is asking about.
    asking: Optional[str] = None
    complete: bool = False
    status: str = "qualifying"
    score: Optional[int] = None
    next_action: Optional[str] = None
    booking_url: Optional[str] = None


class QualificationSubmit(BaseModel):
    """Direct submission of the six qualification answers (form or n8n)."""

    session_id: Optional[str] = Field(default=None, max_length=64)
    lead_id: Optional[UUID] = None
    source: Literal["website_chat", "sms", "phone", "referral"] = "website_chat"
    name: Optional[str] = Field(default=None, max_length=200)
    phone: Optional[str] = Field(default=None, max_length=32)
    email: Optional[str] = Field(default=None, max_length=200)
    treatment_interest: Optional[TreatmentInterest] = None
    previous_experience: Optional[bool] = None
    is_pregnant: Optional[bool] = None
    blood_thinner: Optional[bool] = None
    budget_range: Optional[BudgetRange] = None
    timeline: Optional[Timeline] = None


class QualificationResult(BaseModel):
    lead_id: UUID
    score: int
    temperature: str
    status: str
    next_action: str
    needs_provider_approval: bool
    medical_callback_required: bool
    booking_url: Optional[str] = None
    score_breakdown: dict[str, Any] = Field(default_factory=dict)
    answered_questions: int = 0


class LeadOut(BaseModel):
    """De-identified lead view. This is what the frontend is allowed to see."""

    lead_id: UUID
    source: str
    status: str
    temperature: Optional[str]
    score: int
    treatment_interest: Optional[str]
    budget_range: Optional[str]
    timeline: Optional[str]
    needs_provider_approval: bool
    medical_callback_required: bool
    display_name: str
    masked_phone: str
    created_at: datetime
    answered_questions: int


# --------------------------------------------------------------------- #
# Voice
# --------------------------------------------------------------------- #
class VoiceSlot(BaseModel):
    start: datetime
    end: datetime
    label: str
    provider: Optional[str] = None


class VoiceInboundResponse(BaseModel):
    call_record_id: UUID
    assistant_overrides: dict[str, Any] = Field(default_factory=dict)
    known_patient: bool = False
    greeting: str


class VoiceActionRequest(BaseModel):
    """A VAPI tool/function call, normalised.

    VAPI posts several message shapes; the router unpacks whichever arrives
    into this model before touching the database.
    """

    action: str
    call_id: Optional[str] = None
    parameters: dict[str, Any] = Field(default_factory=dict)


class VoiceActionResponse(BaseModel):
    result: dict[str, Any] = Field(default_factory=dict)
    speech: Optional[str] = None


class VoiceEndRequest(BaseModel):
    call_id: Optional[str] = None
    transcript: Optional[str] = None
    duration_seconds: Optional[int] = None
    outcome: Optional[str] = None
    ended_reason: Optional[str] = None
    summary: dict[str, Any] = Field(default_factory=dict)
