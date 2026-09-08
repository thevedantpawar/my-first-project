"""Creating, reading and provisioning a clinic.

Every route is scoped to the caller's account through ``clinic_for_user``,
which filters by ``account_id`` in the query rather than fetching and comparing
afterwards. That is the whole tenant boundary in this service, so it is written
the way that cannot express the bug.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.dependencies import clinic_for_user, current_user, get_audit, require_owner
from app.models.clinic import Clinic, ClinicStatus
from app.models.user import User
from app.schemas import (
    ClinicCreateRequest,
    ClinicDetailResponse,
    ClinicResponse,
    ClinicUpdateRequest,
    EncryptionKeyResponse,
    ProvisioningEventResponse,
)
from app.services import billing
from app.services.accounts import _unique_slug
from app.services.audit import AuditAction, AuditLogger
from app.services.provisioning import Provisioner, ProvisioningError
from app.utils import slugify

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/clinics", tags=["clinics"])


def _to_response(clinic: Clinic) -> ClinicResponse:
    return ClinicResponse(
        id=str(clinic.id),
        name=clinic.name,
        slug=clinic.slug,
        status=clinic.status,
        status_detail=clinic.status_detail,
        timezone=clinic.timezone,
        contact_email=clinic.contact_email,
        phone=clinic.phone,
        engine_url=clinic.engine_url,
        console_url=clinic.console_url,
        integrations=clinic.integrations or {},
        key_backup_confirmed=clinic.key_backup_confirmed,
        provisioned_at=clinic.provisioned_at,
        created_at=clinic.created_at,
    )


@router.get("", response_model=list[ClinicResponse])
def list_clinics(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[ClinicResponse]:
    clinics = (
        db.query(Clinic)
        .filter(Clinic.account_id == user.account_id)
        .order_by(Clinic.created_at)
        .all()
    )
    return [_to_response(c) for c in clinics]


@router.post("", response_model=ClinicResponse, status_code=status.HTTP_201_CREATED)
def create_clinic(
    payload: ClinicCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_owner),
    audit: AuditLogger = Depends(get_audit),
) -> ClinicResponse:
    """Create a clinic. Provisioning is a separate, explicit step.

    The plan limit is checked here rather than at provisioning time, so an
    account over its limit finds out before any infrastructure is built.
    """
    allowed, reason = billing.can_add_clinic(db, user.account)
    if not allowed:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=reason)

    if payload.close_hour <= payload.open_hour:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Closing time must be after opening time.",
        )

    clinic = Clinic(
        account_id=user.account_id,
        name=payload.name.strip(),
        slug=_unique_slug(db, Clinic, payload.name),
        timezone=payload.timezone,
        contact_email=payload.contact_email,
        phone=payload.phone,
        booking_url=payload.booking_url,
        review_url=payload.review_url,
        open_hour=payload.open_hour,
        close_hour=payload.close_hour,
        status=ClinicStatus.PENDING,
        integrations={},
    )
    db.add(clinic)
    db.flush()

    audit.log(AuditAction.CLINIC_CREATED, user=user, clinic_id=clinic.id,
              details={"slug": clinic.slug})
    db.commit()
    return _to_response(clinic)


@router.get("/{clinic_id}", response_model=ClinicDetailResponse)
def get_clinic(
    clinic_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> ClinicDetailResponse:
    clinic = clinic_for_user(clinic_id, user, db)
    base = _to_response(clinic).model_dump()
    return ClinicDetailResponse(
        **base,
        provisioning=[
            ProvisioningEventResponse(
                step=e.step,
                outcome=e.outcome,
                sequence=e.sequence,
                message=e.message,
                duration_ms=e.duration_ms,
                created_at=e.created_at,
            )
            for e in clinic.provisioning_events
        ],
    )


@router.patch("/{clinic_id}", response_model=ClinicResponse)
def update_clinic(
    clinic_id: str,
    payload: ClinicUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_owner),
) -> ClinicResponse:
    """Update a clinic's profile.

    The slug is deliberately immutable: it names live Railway resources, and
    renaming it here would silently disconnect this row from the deployment it
    describes.
    """
    clinic = clinic_for_user(clinic_id, user, db)

    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(clinic, field, value)

    if clinic.close_hour <= clinic.open_hour:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Closing time must be after opening time.",
        )

    db.commit()
    return _to_response(clinic)


def _provision_in_background(clinic_id: str) -> None:
    """Run provisioning with its own session.

    Provisioning takes a minute or more of calls to Railway, which is far too
    long to hold a request open. It gets its own session because the request's
    is closed the moment the response is sent.
    """
    db = SessionLocal()
    try:
        clinic = db.get(Clinic, clinic_id)
        if clinic is None:
            return
        Provisioner(db, clinic).provision()
    except ProvisioningError:
        # Already recorded on the clinic and in its event log by the
        # provisioner; the UI reads it from there.
        logger.warning("Provisioning failed for clinic %s", clinic_id)
    except Exception:  # noqa: BLE001 - a background task must not die silently
        logger.exception("Unexpected error provisioning clinic %s", clinic_id)
    finally:
        db.close()


@router.post("/{clinic_id}/provision", response_model=ClinicResponse, status_code=202)
def provision_clinic(
    clinic_id: str,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_owner),
    audit: AuditLogger = Depends(get_audit),
) -> ClinicResponse:
    """Build this clinic's engine. Returns immediately; poll for progress."""
    clinic = clinic_for_user(clinic_id, user, db)

    if clinic.status == ClinicStatus.PROVISIONING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This clinic is already being provisioned.",
        )
    if clinic.status == ClinicStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This clinic is already running.",
        )

    subscription = billing.get_or_create_subscription(db, user.account)
    if not subscription.is_entitled:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="This account does not have an active subscription.",
        )

    clinic.status = ClinicStatus.PROVISIONING
    clinic.status_detail = None
    audit.log(AuditAction.CLINIC_PROVISIONED, user=user, clinic_id=clinic.id)
    db.commit()

    background.add_task(_provision_in_background, str(clinic.id))
    return _to_response(clinic)


@router.get("/{clinic_id}/encryption-key", response_model=EncryptionKeyResponse)
def reveal_encryption_key(
    clinic_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_owner),
    audit: AuditLogger = Depends(get_audit),
) -> EncryptionKeyResponse:
    """Reveal a clinic's encryption key, so the owner can back it up.

    The single most sensitive action in the product: this key decrypts that
    clinic's PHI. Owner-only, its own response model so it cannot leak through
    a shared schema, and audited on every call — the audit row is the point,
    because the key itself is already in the database.
    """
    clinic = clinic_for_user(clinic_id, user, db)

    if not clinic.encryption_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This clinic has no encryption key yet — it has not been provisioned.",
        )

    audit.log(AuditAction.KEY_REVEALED, user=user, clinic_id=clinic.id)
    db.commit()

    return EncryptionKeyResponse(
        clinic_id=str(clinic.id),
        encryption_key=clinic.encryption_key,
        warning=(
            "This key decrypts every patient record in this clinic. Store it in a "
            "password manager or a safe, never in email or chat. If it is lost and "
            "this control plane is lost, the clinic's records cannot be recovered."
        ),
    )


@router.post("/{clinic_id}/confirm-key-backup", response_model=ClinicResponse)
def confirm_key_backup(
    clinic_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_owner),
) -> ClinicResponse:
    """Record that the owner has stored the encryption key somewhere safe."""
    clinic = clinic_for_user(clinic_id, user, db)
    clinic.key_backup_confirmed = True
    db.commit()
    return _to_response(clinic)
