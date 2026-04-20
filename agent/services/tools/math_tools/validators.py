"""Validation and parsing helpers for the advanced math tool."""

from __future__ import annotations

from fractions import Fraction
import math
import re

import sympy as sp
from sympy.parsing.sympy_parser import convert_xor, parse_expr, standard_transformations

SUPPORTED_OPERATIONS = {
    "evaluate",
    "simplify",
    "solve",
    "calculus",
    "matrix",
    "statistics",
    "units",
    "plot",
}
NOT_IMPLEMENTED_OPERATIONS: set[str] = set()
_ALLOWED_TEXT_PATTERN = re.compile(r"^[A-Za-z0-9_+\-*/^().,=\s]*$")
_IDENTIFIER_PATTERN = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]*\b")
_SYMBOL_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_UNIT_TEXT_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_ */^-]*$")
_PLOT_TITLE_PATTERN = re.compile(r"^[A-Za-z0-9 _().-]+$")
_TRANSFORMATIONS = standard_transformations + (convert_xor,)
_MAX_INPUT_LENGTH = 256
_MAX_SYMBOL_TOKENS = 32
_MAX_EQUATION_COUNT = 5
_MAX_VARIABLE_COUNT = 8
_MAX_MATRIX_DIMENSION = 8
_MAX_VALUES_COUNT = 128
_MAX_EXACT_FLOAT_INT = 2**53
_DEFAULT_PLOT_POINTS = 201
_MAX_ARTIFACT_TITLE_LENGTH = 80
_SAFE_GLOBALS = {
    "__builtins__": {},
    "Float": sp.Float,
    "Integer": sp.Integer,
    "Rational": sp.Rational,
}
_SAFE_NAMESPACE = {
    "Abs": sp.Abs,
    "E": sp.E,
    "I": sp.I,
    "cos": sp.cos,
    "exp": sp.exp,
    "log": sp.log,
    "oo": sp.oo,
    "pi": sp.pi,
    "sin": sp.sin,
    "sqrt": sp.sqrt,
    "tan": sp.tan,
}
_UNIT_REGISTRY = None


def validate_math_text(value: str, field_name: str) -> str:
    """Validate a math expression or equation before parsing."""
    text = value.strip()
    if not text:
        raise ValueError(f"Field '{field_name}' cannot be empty.")
    if len(text) > _MAX_INPUT_LENGTH:
        raise ValueError(f"Field '{field_name}' exceeds the maximum supported length.")
    if not _ALLOWED_TEXT_PATTERN.fullmatch(text):
        raise ValueError(f"Field '{field_name}' contains unsupported characters.")
    if "__" in text or re.search(r"[A-Za-z_]\.", text) or re.search(r"\.[A-Za-z_]", text):
        raise ValueError(f"Field '{field_name}' contains unsupported syntax.")
    if len(_IDENTIFIER_PATTERN.findall(text)) > _MAX_SYMBOL_TOKENS:
        raise ValueError(f"Field '{field_name}' contains too many symbols.")
    return text


def validate_equations(equations: list[str] | None) -> list[str]:
    """Validate the solve equations list with lightweight size limits."""
    if not equations:
        return []
    if len(equations) > _MAX_EQUATION_COUNT:
        raise ValueError("Field 'equations' contains too many equations.")
    return [validate_math_text(equation, "equations") for equation in equations]


def validate_unit_text(value: str | None, field_name: str) -> str:
    """Validate lightweight unit strings before handing them to Pint."""
    if value is None:
        raise ValueError(f"Field '{field_name}' is required for operation 'units'.")

    text = value.strip()
    if not text:
        raise ValueError(f"Field '{field_name}' cannot be empty.")
    if len(text) > _MAX_INPUT_LENGTH:
        raise ValueError(f"Field '{field_name}' exceeds the maximum supported length.")
    if not _UNIT_TEXT_PATTERN.fullmatch(text):
        raise ValueError(f"Field '{field_name}' contains unsupported characters.")
    if "__" in text:
        raise ValueError(f"Field '{field_name}' contains unsupported syntax.")
    return text


def validate_matrix(matrix: object, field_name: str) -> list[list[int | float]]:
    """Validate small numeric matrices used by deterministic matrix operations."""
    if matrix is None:
        raise ValueError(f"Field '{field_name}' is required for operation 'matrix'.")
    if not isinstance(matrix, list) or not matrix:
        raise ValueError(f"Field '{field_name}' must be a non-empty matrix.")
    if len(matrix) > _MAX_MATRIX_DIMENSION:
        raise ValueError(f"Field '{field_name}' contains too many rows.")

    validated_rows: list[list[int | float]] = []
    expected_width: int | None = None
    for row in matrix:
        if not isinstance(row, list) or not row:
            raise ValueError(f"Field '{field_name}' must contain non-empty rows.")
        if len(row) > _MAX_MATRIX_DIMENSION:
            raise ValueError(f"Field '{field_name}' contains too many columns.")
        if expected_width is None:
            expected_width = len(row)
        elif len(row) != expected_width:
            raise ValueError(f"Field '{field_name}' must be rectangular.")

        validated_row: list[int | float] = []
        for item in row:
            if isinstance(item, bool) or not isinstance(item, (int, float)):
                raise ValueError(f"Field '{field_name}' must contain only numeric values.")
            if not math.isfinite(item):
                raise ValueError(f"Field '{field_name}' must contain only finite numeric values.")
            validated_row.append(item)
        validated_rows.append(validated_row)

    return validated_rows


def validate_values(values: object) -> list[int | float]:
    """Validate a bounded numeric series for descriptive statistics."""
    if values is None:
        raise ValueError("Field 'values' is required for operation 'statistics'.")
    if not isinstance(values, list) or not values:
        raise ValueError("Field 'values' must be a non-empty list.")
    if len(values) > _MAX_VALUES_COUNT:
        raise ValueError("Field 'values' contains too many items.")

    validated_values: list[int | float] = []
    for item in values:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            raise ValueError("Field 'values' must contain only numeric values.")
        if not math.isfinite(item):
            raise ValueError("Field 'values' must contain only finite numeric values.")
        validated_values.append(item)
    return validated_values


def validate_plot_points(value: object) -> int:
    """Validate the requested plot sample count."""
    if value is None:
        return _DEFAULT_PLOT_POINTS
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("Field 'plot_points' must be an integer.")
    if value < 2 or value > 512:
        raise ValueError("Field 'plot_points' must be between 2 and 512.")
    return value


def validate_plot_title(value: object) -> str | None:
    """Validate an optional plot title and keep it filesystem-safe."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Field 'plot_title' must be a string.")

    text = value.strip()
    if not text:
        raise ValueError("Field 'plot_title' cannot be empty.")
    if len(text) > 120:
        raise ValueError("Field 'plot_title' exceeds the maximum supported length.")
    if not _PLOT_TITLE_PATTERN.fullmatch(text):
        raise ValueError("Field 'plot_title' contains unsupported characters.")
    return text


def make_plot_artifact_title(plot_title: str | None, expression: str) -> str:
    """Create a deterministic artifact title for plot outputs."""
    base_title = plot_title or f"Plot of {expression}"
    sanitized = re.sub(r"[^A-Za-z0-9 _().-]", "_", base_title).strip()
    sanitized = re.sub(r"\s+", " ", sanitized)
    if not sanitized:
        sanitized = "plot"
    sanitized = sanitized[:_MAX_ARTIFACT_TITLE_LENGTH].rstrip(" .")
    return f"{sanitized}.png.base64"


def build_symbol_table(expressions: list[str], variables: list[str] | None) -> dict[str, object]:
    """Build the parser local namespace from safe functions, constants, and symbols."""
    namespace: dict[str, object] = dict(_SAFE_NAMESPACE)
    if variables is not None and len(variables) > _MAX_VARIABLE_COUNT:
        raise ValueError("Field 'variables' contains too many symbols.")
    for variable_name in variables or []:
        if not _SYMBOL_NAME_PATTERN.fullmatch(variable_name):
            raise ValueError(f"Variable '{variable_name}' is not a valid symbol name.")
        namespace[variable_name] = sp.Symbol(variable_name)

    for expression in expressions:
        for identifier in _IDENTIFIER_PATTERN.findall(expression):
            if identifier not in namespace:
                namespace[identifier] = sp.Symbol(identifier)

    return namespace


def parse_expression(expression: str, namespace: dict[str, object]) -> sp.Expr:
    """Parse a single safe SymPy expression."""
    try:
        parsed = parse_expr(
            expression,
            global_dict=_SAFE_GLOBALS,
            local_dict=namespace,
            transformations=_TRANSFORMATIONS,
        )
    except Exception as exc:
        raise ValueError(f"Unable to parse expression '{expression}': {exc}") from exc

    if not isinstance(parsed, sp.Basic):
        raise ValueError(f"Expression '{expression}' did not produce a valid symbolic result.")
    return parsed


def parse_numeric_expression(value: str | int | float, field_name: str) -> sp.Expr:
    """Parse a scalar numeric expression and reject free symbols."""
    if isinstance(value, bool):
        raise ValueError(f"Field '{field_name}' must be numeric.")
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise ValueError(f"Field '{field_name}' must be finite.")
        return sp.Float(value) if isinstance(value, float) else sp.Integer(value)
    if not isinstance(value, str):
        raise ValueError(f"Field '{field_name}' must be numeric.")

    clean_value = validate_math_text(value, field_name)
    namespace = build_symbol_table([clean_value], variables=None)
    parsed_value = sp.simplify(parse_expression(clean_value, namespace))
    if parsed_value.free_symbols:
        raise ValueError(f"Field '{field_name}' must evaluate to a numeric value.")
    if parsed_value.has(sp.zoo, sp.oo, -sp.oo, sp.nan):
        raise ValueError(f"Field '{field_name}' must evaluate to a finite numeric value.")
    if parsed_value.is_real is False:
        raise ValueError(f"Field '{field_name}' must evaluate to a real numeric value.")
    return parsed_value


def matrix_to_result(matrix: sp.MatrixBase) -> list[list[str]]:
    """Serialize matrix entries into deterministic string values."""
    return [[sp.sstr(item) for item in row] for row in matrix.tolist()]


def get_unit_registry():
    """Load Pint lazily so non-unit operations still work when the dependency is absent."""
    global _UNIT_REGISTRY
    if _UNIT_REGISTRY is None:
        try:
            from pint import UnitRegistry
        except ModuleNotFoundError as exc:  # pragma: no cover - environment-dependent
            raise RuntimeError("Unit conversion requires the 'pint' package.") from exc
        _UNIT_REGISTRY = UnitRegistry()
    return _UNIT_REGISTRY


def serialize_statistic_value(value: int | float | Fraction) -> int | float | str:
    """Keep exact rational statistics exact while preserving existing numeric outputs when safe."""
    if isinstance(value, Fraction):
        if value.denominator == 1:
            return serialize_statistic_value(value.numerator)
        float_value = float(value)
        if math.isfinite(float_value) and Fraction.from_float(float_value) == value:
            return float_value
        return f"{value.numerator}/{value.denominator}"
    if isinstance(value, int):
        if abs(value) > _MAX_EXACT_FLOAT_INT:
            return value
        return float(value)
    return float(value)


def population_variance_fraction(values: list[int]) -> Fraction:
    """Compute exact population variance for integer-only inputs."""
    mean_value = Fraction(sum(values), len(values))
    return sum((Fraction(item) - mean_value) ** 2 for item in values) / len(values)
