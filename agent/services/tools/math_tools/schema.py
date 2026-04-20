"""Schema definitions for the advanced math tool."""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, Field

MathOperation = Literal[
    "evaluate",
    "simplify",
    "solve",
    "calculus",
    "matrix",
    "statistics",
    "units",
    "plot",
]

_INTEGER_STRING_PATTERN = re.compile(r"^[+-]?\d+$")


def _coerce_statistics_value(value: Any) -> Any:
    """Preserve raw integer inputs while still accepting simple numeric strings."""
    if isinstance(value, bool):
        raise ValueError("Boolean values are not valid numeric inputs.")
    if isinstance(value, (int, float)):
        return value
    if not isinstance(value, str):
        return value

    text = value.strip()
    if not text:
        return value
    if _INTEGER_STRING_PATTERN.fullmatch(text):
        return int(text)

    try:
        return float(text)
    except ValueError:
        return value


StatisticsValue = Annotated[int | float, BeforeValidator(_coerce_statistics_value)]


class AdvancedMathInput(BaseModel):
    """Input schema for advanced symbolic math operations."""

    operation: Annotated[
        MathOperation,
        Field(
            description=(
                "Math operation to run. Supported routes: evaluate, simplify, solve, calculus, "
                "matrix, statistics, units, plot."
            ),
            examples=["evaluate", "solve"],
        ),
    ]
    expression: Annotated[
        str | None,
        Field(
            description="Single symbolic expression used by evaluate and future expression-based routes.",
            examples=["2 + 3 * 4", "sin(pi / 2)", "x^2 + 2*x + 1"],
        ),
    ] = None
    equations: Annotated[
        list[str] | None,
        Field(
            description="Equation strings for solve. Plain expressions are treated as '= 0'.",
            examples=[["x**2 - 4", "x + y - 5"]],
        ),
    ] = None
    variables: Annotated[
        list[str] | None,
        Field(
            description="Variable names to solve for or to seed the parser symbol table.",
            examples=[["x"], ["x", "y"]],
        ),
    ] = None
    matrix_a: Annotated[
        list[list[float]] | None,
        Field(
            description="Primary numeric matrix for matrix operations.",
            examples=[[[1, 2], [3, 4]]],
        ),
    ] = None
    matrix_b: Annotated[
        list[list[float]] | None,
        Field(
            description="Secondary numeric matrix used by binary matrix operations such as multiply.",
            examples=[[[2, 0], [1, 2]]],
        ),
    ] = None
    values: Annotated[
        list[StatisticsValue] | None,
        Field(
            description="Numeric values for descriptive statistics.",
            examples=[[1, 2, 3, 4]],
        ),
    ] = None
    from_unit: Annotated[
        str | None,
        Field(
            description="Source unit string for unit conversion.",
            examples=["meter"],
        ),
    ] = None
    to_unit: Annotated[
        str | None,
        Field(
            description="Target unit string for unit conversion.",
            examples=["centimeter"],
        ),
    ] = None
    matrix_operation: Annotated[
        str | None,
        Field(
            description="Matrix action such as determinant, transpose, inverse, or multiply.",
            examples=["determinant", "multiply"],
        ),
    ] = None
    calculus_operation: Annotated[
        str | None,
        Field(
            description="Calculus action such as derivative, integral, or limit.",
            examples=["derivative", "integral"],
        ),
    ] = None
    statistic: Annotated[
        str | None,
        Field(
            description="Statistic to compute, such as mean, median, mode, variance, std, min, or max.",
            examples=["mean", "std"],
        ),
    ] = None
    limit_point: Annotated[
        str | None,
        Field(
            description="Limit evaluation point for calculus limit operations.",
            examples=["0", "pi / 2"],
        ),
    ] = None
    plot_x_min: Annotated[
        str | int | float | None,
        Field(
            description="Lower bound of the x-axis domain for plotting.",
            examples=[-10, "-pi"],
        ),
    ] = None
    plot_x_max: Annotated[
        str | int | float | None,
        Field(
            description="Upper bound of the x-axis domain for plotting.",
            examples=[10, "pi"],
        ),
    ] = None
    plot_points: Annotated[
        int | None,
        Field(
            description="Number of sample points to evaluate for plotting.",
            examples=[201],
            ge=2,
            le=512,
        ),
    ] = None
    plot_title: Annotated[
        str | None,
        Field(
            description="Optional plot title used both in the figure and artifact title.",
            examples=["Parabola", "Sine Wave"],
            max_length=120,
        ),
    ] = None
