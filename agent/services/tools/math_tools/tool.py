"""Tool entry point and routing for the advanced math package."""

from __future__ import annotations

import json
import logging

from agent_framework import tool

from agent.services.tools.artifact_context import save_local_artifact

from .handlers import (
    handle_calculus,
    handle_evaluate,
    handle_matrix,
    handle_plot,
    handle_simplify,
    handle_solve,
    handle_statistics,
    handle_units,
)
from .schema import AdvancedMathInput
from .validators import NOT_IMPLEMENTED_OPERATIONS, SUPPORTED_OPERATIONS

logger = logging.getLogger(__name__)


def _json_response(
    *,
    operation: str,
    status: str,
    explanation: str | None,
    result: object = None,
    error: object = None,
) -> str:
    """Serialize deterministic JSON payloads for tool output."""
    return json.dumps(
        {
            "error": error,
            "explanation": explanation,
            "operation": operation,
            "result": result,
            "status": status,
        },
        allow_nan=False,
        sort_keys=True,
    )


def _json_error(operation: str, code: str, message: str) -> str:
    """Return a structured error payload."""
    return _json_response(
        operation=operation,
        status="error",
        explanation=None,
        result=None,
        error={"code": code, "message": message},
    )


@tool(
    name="advanced_math",
    description=(
        "Perform advanced math operations with structured JSON output. Implements evaluate, "
        "simplify, solve, calculus, matrix, statistics, units, and deterministic plotting."
    ),
    schema=AdvancedMathInput,
    max_invocations=50,
)
async def advanced_math_tool(
    operation: str,
    expression: str | None = None,
    equations: list[str] | None = None,
    variables: list[str] | None = None,
    **kwargs: object,
) -> str:
    """Route structured math requests to the correct handler."""
    if operation not in SUPPORTED_OPERATIONS:
        return _json_error(operation, "unsupported_operation", f"Operation '{operation}' is not supported.")

    if operation in NOT_IMPLEMENTED_OPERATIONS:
        return _json_error(operation, "not_implemented", f"Operation '{operation}' is not implemented yet.")

    try:
        if operation == "evaluate":
            result = handle_evaluate(expression)
            explanation = "Evaluated expression successfully."
        elif operation == "simplify":
            result = handle_simplify(expression)
            explanation = "Simplified expression successfully."
        elif operation == "solve":
            result = handle_solve(expression, equations, variables)
            explanation = "Solved expression successfully."
        elif operation == "calculus":
            result = handle_calculus(
                expression,
                variables,
                calculus_operation=kwargs.get("calculus_operation"),
                limit_point=kwargs.get("limit_point"),
            )
            explanation = f"Computed calculus operation '{result['calculus_operation']}' successfully."
        elif operation == "matrix":
            result = handle_matrix(
                matrix_a=kwargs.get("matrix_a"),
                matrix_b=kwargs.get("matrix_b"),
                matrix_operation=kwargs.get("matrix_operation"),
            )
            explanation = f"Computed matrix operation '{result['matrix_operation']}' successfully."
        elif operation == "statistics":
            result = handle_statistics(
                values=kwargs.get("values"),
                statistic=kwargs.get("statistic"),
            )
            explanation = f"Computed statistic '{result['statistic']}' successfully."
        elif operation == "plot":
            result = handle_plot(
                expression,
                variables,
                plot_x_min=kwargs.get("plot_x_min"),
                plot_x_max=kwargs.get("plot_x_max"),
                plot_points=kwargs.get("plot_points"),
                plot_title=kwargs.get("plot_title"),
            )

            session = kwargs.get("session")
            if not session:
                raise RuntimeError("No active session available for saving plot artifacts.")

            artifact_title = str(result.pop("_artifact_title"))
            artifact_content = str(result.pop("_artifact_content"))
            artifact_id = await save_local_artifact(
                session,
                title=artifact_title,
                content=artifact_content,
                tool_name="advanced_math_plot",
            )
            result["artifact"] = {
                "artifact_id": artifact_id,
                "content_encoding": "base64",
                "mime_type": "image/png",
                "title": artifact_title,
            }
            explanation = "Generated plot successfully."
        else:
            result = handle_units(
                expression,
                from_unit=kwargs.get("from_unit"),
                to_unit=kwargs.get("to_unit"),
            )
            explanation = "Converted units successfully."
    except ValueError as exc:
        return _json_error(operation, "invalid_input", str(exc))
    except RuntimeError as exc:
        return _json_error(operation, "internal_error", str(exc))
    except Exception as exc:  # pragma: no cover - defensive runtime guard
        logger.exception("advanced_math failed for operation=%s: %s", operation, exc)
        return _json_error(operation, "internal_error", "Advanced math tool failed unexpectedly.")

    return _json_response(
        operation=operation,
        status="ok",
        explanation=explanation,
        result=result,
        error=None,
    )
