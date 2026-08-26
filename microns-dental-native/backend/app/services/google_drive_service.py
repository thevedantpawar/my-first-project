"""Google Drive — per-lead folders and non-PHI activity logs.

HIPAA note (see ``config.py``'s de-identification rule): anything this service
writes uses patient/lead **UUIDs** in filenames and log lines, never names or
phone numbers. ``create_lead_folder`` takes a display name only for the
*folder title* a human will scan in Drive — pass a UUID-suffixed name if your
practice's compliance policy requires it; the default in
``lead_service.py`` uses the lead's first name plus a short id, which is a
judgment call practices should confirm against their own BAA scope.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseDownload
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from app.config import settings
from app.services.google_auth_service import GoogleAuthService, get_google_auth

logger = logging.getLogger(__name__)

_FOLDER_MIME = "application/vnd.google-apps.folder"


def _retryable(exc: BaseException) -> bool:
    return isinstance(exc, HttpError) and exc.resp is not None and exc.resp.status in {429, 500, 503}


_retry = retry(
    retry=retry_if_exception(_retryable),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=0.5, min=0.5, max=8),
    reraise=True,
)


class GoogleDriveService:
    def __init__(self, auth: Optional[GoogleAuthService] = None) -> None:
        self.auth = auth or get_google_auth()

    @_retry
    def create_folder(self, name: str, *, parent_id: Optional[str] = None) -> dict[str, Any]:
        body: dict[str, Any] = {"name": name, "mimeType": _FOLDER_MIME}
        parent = parent_id or settings.google_drive_folder_id
        if parent:
            body["parents"] = [parent]
        folder = self.auth.drive().files().create(body=body, fields="id, name, webViewLink").execute()
        logger.info("Created Drive folder %s (%s)", folder.get("name"), folder.get("id"))
        return folder

    @_retry
    def _find_log_file(self, name: str, *, parent_id: Optional[str]) -> Optional[str]:
        parent = parent_id or settings.google_drive_folder_id
        query = f"name = '{name}' and trashed = false"
        if parent:
            query += f" and '{parent}' in parents"
        response = self.auth.drive().files().list(q=query, fields="files(id, name)", pageSize=1).execute()
        files = response.get("files", [])
        return files[0]["id"] if files else None

    def append_log_line(self, log_name: str, line: str, *, parent_id: Optional[str] = None) -> str:
        """Append one line to a plain-text log file, creating it on first use.

        Used for the "Review Activity" and "Insurance Verification" logs the
        spec calls out. A single small text file re-uploaded on each append is
        the simplest thing that works at practice scale; swap for a Sheets
        append (``sheets.values.append``) if a practice wants a spreadsheet
        view instead — the interface here (one call, one line in) stays the
        same either way.
        """
        file_id = self._find_log_file(log_name, parent_id=parent_id)
        existing = self._download_text(file_id) if file_id else ""
        updated = (existing + ("\n" if existing and not existing.endswith("\n") else "") + line + "\n")
        return self._upload_text(log_name, updated, file_id=file_id, parent_id=parent_id)

    @_retry
    def _download_text(self, file_id: str) -> str:
        import io

        request = self.auth.drive().files().get_media(fileId=file_id)
        buffer = io.BytesIO()
        downloader = MediaIoBaseDownload(buffer, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return buffer.getvalue().decode("utf-8", errors="replace")

    @_retry
    def _upload_text(
        self, name: str, content: str, *, file_id: Optional[str], parent_id: Optional[str]
    ) -> str:
        from googleapiclient.http import MediaIoBaseUpload
        import io

        media = MediaIoBaseUpload(io.BytesIO(content.encode("utf-8")), mimetype="text/plain", resumable=False)
        if file_id:
            updated = self.auth.drive().files().update(fileId=file_id, media_body=media).execute()
            return updated["id"]

        body: dict[str, Any] = {"name": name, "mimeType": "text/plain"}
        parent = parent_id or settings.google_drive_folder_id
        if parent:
            body["parents"] = [parent]
        created = self.auth.drive().files().create(body=body, media_body=media, fields="id").execute()
        return created["id"]


_service: Optional[GoogleDriveService] = None


def get_drive_service() -> GoogleDriveService:
    global _service
    if _service is None:
        _service = GoogleDriveService()
    return _service


__all__ = ["GoogleDriveService", "get_drive_service"]
