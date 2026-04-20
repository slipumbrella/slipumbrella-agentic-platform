"""
Knowledge-base tools — let agents inspect the session's uploaded files and
evaluation results by querying the PostgreSQL database directly.
"""

import json
import logging
from typing import Any

from agent_framework import tool
from pydantic import BaseModel

from agent.db import database as db

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _session_id(kwargs: dict[str, Any]) -> str | None:
    session = kwargs.get("session")
    if session is None:
        return None
    return getattr(session, "session_id", None)


# ---------------------------------------------------------------------------
# list_uploaded_files
# ---------------------------------------------------------------------------


class ListUploadedFilesInput(BaseModel):
    pass  # no user input — session is injected


@tool(
    name="list_uploaded_files",
    description=(
        "List all files that have been uploaded to the current session's knowledge base. "
        "Returns file names, types, embedding status, and upload time. "
        "Call this to understand what documents are available before generating answers."
    ),
    schema=ListUploadedFilesInput,
    max_invocations=5,
)
async def list_uploaded_files_tool(**kwargs: object) -> str:
    ref_id = _session_id(kwargs)  # type: ignore[arg-type]
    if not ref_id:
        return "No session context available — cannot list files."

    try:
        attachments = await db.get_attachments(ref_id)
    except Exception as exc:
        logger.error("list_uploaded_files DB error: %s", exc)
        return f"Failed to fetch uploads from database: {exc}"

    if not attachments:
        return "No files have been uploaded to this session's knowledge base yet."

    lines = [f"Uploaded files for session ({ref_id}):\n"]
    for i, att in enumerate(attachments, 1):
        # Database columns: original_filename, file_key, is_embedded, created_at
        name = (
            att.get("original_filename")
            or att.get("file_name")
            or att.get("file_key", "unknown")
        )
        embedded = "✓ embedded" if att.get("is_embedded") else "○ not embedded"

        # Determine file type from extension
        file_key = att.get("file_key", "")
        file_type = "unknown"
        if "." in file_key:
            file_type = file_key.split(".")[-1].upper()

        created = att.get("created_at")
        created_str = created.strftime("%Y-%m-%d") if created else "unknown"

        lines.append(
            f"  {i}. {name}  [{file_type}]  {embedded}  uploaded {created_str}"
        )

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# get_evaluation_result
# ---------------------------------------------------------------------------


class GetEvaluationResultInput(BaseModel):
    pass  # session is injected; no user input required


@tool(
    name="get_evaluation_result",
    description=(
        "Retrieve the latest RAG evaluation result for the current session's knowledge base. "
        "Returns overall quality score (0-100), per-metric scores (AnswerRelevancy, "
        "Faithfulness, ContextualRelevancy), and actionable improvement reasons. "
        "Use this to advise users on knowledge-base quality before executing a plan."
    ),
    schema=GetEvaluationResultInput,
    max_invocations=5,
)
async def get_evaluation_result_tool(**kwargs: object) -> str:
    ref_id = _session_id(kwargs)  # type: ignore[arg-type]
    if not ref_id:
        return "No session context available — cannot fetch evaluation."

    try:
        ev = await db.get_latest_evaluation(ref_id)
    except Exception as exc:
        logger.error("get_evaluation_result DB error: %s", exc)
        return f"Failed to fetch evaluation from database: {exc}"

    if not ev:
        return "No evaluation has been run for this session yet. Upload and embed files first."

    status = ev.get("status", "unknown")

    if status == "pending" or status == "running":
        return f"Evaluation is currently {status}. Try again in a moment."

    if status == "failed":
        msg = ev.get("error_message") or "unknown error"
        return f"Evaluation failed: {msg}"

    if status != "completed":
        return f"Evaluation status is '{status}' — no results available yet."

    eval_reference_id = ev.get("reference_id")
    overall = ev.get("overall_score", 0)
    test_count = ev.get("test_cases_count", 0)
    metrics = ev.get("metrics") or []

    # Ensure metrics is a list (handled by get_latest_evaluation but safe-guarding)
    if isinstance(metrics, str):
        try:
            metrics = json.loads(metrics)
        except:
            metrics = []

    lines = [
        f"Knowledge Base Evaluation — Session {ref_id}",
        f"Overall Score : {overall:.1f} / 100  ({test_count} test cases)",
    ]
    if (
        isinstance(eval_reference_id, str)
        and eval_reference_id
        and eval_reference_id != ref_id
    ):
        lines.append(f"(Resolved from related reference: {eval_reference_id})")
    lines.extend(
        [
            "",
            "Metric Breakdown:",
        ]
    )
    for m in metrics:
        name = m.get("metric_name", "?")
        score = m.get("score", 0)
        passed = "✓" if m.get("passed") else "✗"
        reason = m.get("reason", "")
        lines.append(f"  {passed} {name}: {score * 100:.0f}%")
        if reason:
            lines.append(f"     → {reason}")

    if overall >= 80:
        lines.append(
            "\nVerdict: Excellent quality — knowledge base is ready for production use."
        )
    elif overall >= 50:
        lines.append(
            "\nVerdict: Moderate quality — consider uploading more specific documents or adding more detail."
        )
    else:
        lines.append(
            "\nVerdict: Poor quality — knowledge base needs significant improvement before use."
        )

    return "\n".join(lines)
