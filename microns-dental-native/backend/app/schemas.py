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
    integrations: dict[str, bool]
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
    provider: Optional[str] = None
    duration_minutes: int = 30
    source: str = "staff"
    sms_consent: bool = True
    notes: Optional[str] = None
    google_event_id: Optional[str] = None


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
# Hygiene recall (Module 1)
# --------------------------------------------------------------------- #
class CalendarWebhookPing(BaseModel):
    """Google Calendar push-notification headers, normalised.

    Google's Calendar push channel POSTs an empty body with everything in
    headers (``X-Goog-Resource-State`` etc.) — the router reads those directly
    and this model exists mainly so ``/retention/calendar-webhook`` has a typed
    response, not a typed request.
    """

    resource_state: Optional[str] = None
    channel_id: Optional[str] = None
    resource_id: Optional[str] = None


class TriggerRecallRequest(BaseModel):
    patient_uuid: UUID
    force: bool = False


class RecallStatusOut(BaseModel):
    patient_uuid: UUID
    stage: Optional[str] = None
    status: str
    next_action_date: Optional[datetime] = None
    last_visit_at: Optional[datetime] = None


class PatientAtRisk(BaseModel):
    patient_uuid: UUID
    display_name: str
    days_since_last_visit: Optional[int]
    last_visit_at: Optional[datetime]
    recall_stage: Optional[str]


class TriggerReviewRequest(BaseModel):
    appointment_id: Optional[UUID] = None
    patient_uuid: Optional[UUID] = None
    force: bool = False


class ReviewReceived(BaseModel):
    appointment_id: UUID
    star_rating: Optional[int] = Field(default=None, ge=1, le=5)
    review_text: Optional[str] = Field(default=None, max_length=4000)
    review_id: Optional[str] = None


# --------------------------------------------------------------------- #
# Treatment plan follow-up (Module 2)
# --------------------------------------------------------------------- #
class TreatmentPlanCreate(BaseModel):
    patient_uuid: UUID
    appointment_id: Optional[UUID] = None
    procedures: list[dict[str, Any]] = Field(default_factory=list)
    total_value_cents: int = Field(ge=0)
    presentation_date: datetime


class TreatmentPlanOut(BaseModel):
    treatment_plan_id: UUID
    patient_uuid: UUID
    display_name: str
    total_value_cents: int
    status: str
    followup_count: int
    presentation_date: datetime
    scheduled_date: Optional[datetime] = None


class ApproveFollowupRequest(BaseModel):
    treatment_plan_id: UUID
    #: The exact SMS text a dentist approved — sent verbatim, never re-generated.
    approved_text: Optional[str] = None


# --------------------------------------------------------------------- #
# Insurance verification (Module 6)
# --------------------------------------------------------------------- #
class InsuranceVerificationRequest(BaseModel):
    appointment_id: UUID


class InsuranceReplyParsed(BaseModel):
    annual_max_remaining_cents: Optional[int] = None
    deductible_met: Optional[bool] = None
    deductible_remaining_cents: Optional[int] = None
    coverage_d0120_pct: Optional[int] = None
    coverage_d1110_pct: Optional[int] = None
    coverage_d4341_pct: Optional[int] = None
    coverage_d2740_pct: Optional[int] = None
    waiting_periods: Optional[bool] = None
    estimated_copay_cents: Optional[int] = None


class InsuranceVerificationOut(BaseModel):
    appointment_id: UUID
    status: str
    parsed: Optional[InsuranceReplyParsed] = None


# --------------------------------------------------------------------- #
# Leads (Module 5)
# --------------------------------------------------------------------- #
TreatmentInterest = Literal[
    "cleaning", "emergency", "invisalign", "implants", "whitening", "veneers", "other"
]
LastVisit = Literal["within_6_months", "1_2_years", "2_plus_years", "never"]
InsuranceType = Literal["ppo", "hmo", "medicaid", "none", "not_sure"]
PainLevel = Literal["severe", "moderate", "none"]
Timeline = Literal["today", "this_week", "within_2_weeks", "browsing"]


class ChatMessage(BaseModel):
    message: str = Field(min_length=0, max_length=2000)
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
    asking: Optional[str] = None
    complete: bool = False
    status: str = "qualifying"
    score: Optional[int] = None
    tier: Optional[str] = None
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
    last_visit: Optional[LastVisit] = None
    insurance_type: Optional[InsuranceType] = None
    pain_level: Optional[PainLevel] = None
    timeline: Optional[Timeline] = None


class QualificationResult(BaseModel):
    lead_id: UUID
    score: int
    tier: str
    status: str
    next_action: str
    booking_url: Optional[str] = None
    score_breakdown: dict[str, Any] = Field(default_factory=dict)
    answered_questions: int = 0


class LeadOut(BaseModel):
    """De-identified lead view. This is what the frontend is allowed to see."""

    lead_id: UUID
    source: str
    status: str
    tier: Optional[str]
    score: int
    treatment_interest: Optional[str]
    timeline: Optional[str]
    display_name: str
    masked_phone: str
    created_at: datetime
    answered_questions: int


# --------------------------------------------------------------------- #
# Voice (Module: emergency triage / booking / insurance FAQ)
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
