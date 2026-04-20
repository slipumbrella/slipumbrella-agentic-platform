"""
Google Workspace service account credential loader.

Credentials are loaded from five GOOGLE_SA_* env vars in agent/.env.
get_credentials() is thread-safe via @lru_cache(maxsize=1).
"""

import functools
import logging

import os

from google.oauth2.service_account import Credentials as SACredentials
from google.oauth2.credentials import Credentials as UserCredentials
from google.auth.transport.requests import Request

from agent.configs.settings import settings

logger = logging.getLogger(__name__)

_SCOPES = [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/presentations",
    "https://www.googleapis.com/auth/drive",  # Full access needed for moving files to shared folders
]


@functools.lru_cache(maxsize=1)
def get_credentials():
    """Build and cache credentials. 
    Prefers User OAuth (token.json) if available, falls back to Service Account.
    """
    token_path = os.path.join(os.path.dirname(__file__), "token.json")
    
    # 1. Try User OAuth
    if os.path.exists(token_path):
        try:
            creds = UserCredentials.from_authorized_user_file(token_path, _SCOPES)
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
                # Update the file with refreshed token
                with open(token_path, 'w') as token:
                    token.write(creds.to_json())
            
            if creds and creds.valid:
                logger.info("Using User OAuth credentials (token.json)")
                return creds
        except Exception as e:
            logger.warning("Failed to load token.json, falling back to service account: %s", e)

    # 2. Fallback to Service Account
    if not settings.GOOGLE_SA_CLIENT_EMAIL:
        raise RuntimeError(
            "Neither token.json nor GOOGLE_SA_CLIENT_EMAIL is set — add it to agent/.env"
        )
    if not settings.GOOGLE_SA_PRIVATE_KEY:
        raise RuntimeError(
            "GOOGLE_SA_PRIVATE_KEY is not set — add it to agent/.env"
        )

    info = {
        "type": "service_account",
        "project_id": settings.GOOGLE_SA_PROJECT_ID,
        "private_key_id": settings.GOOGLE_SA_PRIVATE_KEY_ID,
        "private_key": settings.GOOGLE_SA_PRIVATE_KEY.replace("\\n", "\n"),
        "client_email": settings.GOOGLE_SA_CLIENT_EMAIL,
        "client_id": settings.GOOGLE_SA_CLIENT_ID,
        "token_uri": "https://oauth2.googleapis.com/token",
    }

    creds = SACredentials.from_service_account_info(info, scopes=_SCOPES)
    logger.info("Using Service Account credentials: %s", settings.GOOGLE_SA_CLIENT_EMAIL)
    return creds


def share_file_if_configured(file_id: str) -> None:
    """Move file into configured folder then transfer ownership to GOOGLE_SHARE_WITH_EMAIL."""
    email = settings.GOOGLE_SHARE_WITH_EMAIL
    folder_id = settings.GOOGLE_DRIVE_FOLDER_ID
    if not email and not folder_id:
        return
    from googleapiclient.discovery import build
    creds = get_credentials()
    drive = build("drive", "v3", credentials=creds)

    if folder_id:
        drive.files().update(
            fileId=file_id,
            addParents=folder_id,
            removeParents="root",
            fields="id, parents",
        ).execute()
        logger.info("Moved file %s to folder %s", file_id, folder_id)

    if email:
        drive.permissions().create(
            fileId=file_id,
            body={"type": "user", "role": "owner", "emailAddress": email},
            transferOwnership=True,
            sendNotificationEmail=False,
        ).execute()
        logger.info("Transferred ownership of file %s to %s", file_id, email)
