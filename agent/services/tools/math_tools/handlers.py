"""Operation handlers for the advanced math tool."""

from __future__ import annotations

import base64
from io import BytesIO
from fractions import Fraction
import math
from statistics import StatisticsError, mean, median, multimode, pstdev, pvariance

import sympy as sp

from .validators import (
    build_symbol_table,
    get_unit_registry,
    matrix_to_result,
    parse_expression,
    parse_numeric_expression,
    population_variance_fraction,
    make_plot_artifact_title,
    serialize_statistic_value,
    validate_equations,
    validate_math_text,
    validate_matrix,
    validate_plot_points,
    validate_plot_title,
    validate_unit_text,
    validate_values,
)


def handle_evaluate(expression: str | None) -> dict[str, object]:
    """Evaluate one expression safely with SymPy."""
    if expression is None:
        raise ValueError("Field 'expression' is required for operation 'evaluate'.")
    clean_expression = validate_math_text(expression, "expression")
    if "=" in clean_expression:
        raise ValueError("Operation 'evaluate' does not accept equations. Use 'solve' instead.")

    namespace = build_symbol_table([clean_expression], variables=None)
    evaluated = sp.simplify(parse_expression(clean_expression, namespace))
    return {
        "expression": clean_expression,
        "value": sp.sstr(evaluated),
    }


def handle_simplify(expression: str | None) -> dict[str, object]:
    """Simplify one expression safely with SymPy."""
    if expression is None:
        raise ValueError("Field 'expression' is required for operation 'simplify'.")

    clean_expression = validate_math_text(expression, "expression")
    if "=" in clean_expression:
        raise ValueError("Operation 'simplify' does not accept equations.")

    namespace = build_symbol_table([clean_expression], variables=None)
    simplified = sp.simplify(parse_expression(clean_expression, namespace))
    return {
        "expression": clean_expression,
        "value": sp.sstr(simplified),
    }


def _parse_equation(equation: str, namespace: dict[str, object]) -> sp.Expr | sp.Equality:
    """Parse either an explicit equation or an implicit '= 0' solve expression."""
    if "=" not in equation:
        return parse_expression(equation, namespace)

    left_text, right_text = (part.strip() for part in equation.split("=", 1))
    if not left_text or not right_text:
        raise ValueError(f"Equation '{equation}' must include expressions on both sides of '='.")

    return sp.Eq(
        parse_expression(left_text, namespace),
        parse_expression(right_text, namespace),
    )


def handle_solve(
    expression: str | None,
    equations: list[str] | None,
    variables: list[str] | None,
) -> dict[str, object]:
    """Solve one or more symbolic equations for the requested variables."""
    if not variables:
        raise ValueError("Field 'variables' is required for operation 'solve'.")

    clean_expression = validate_math_text(expression, "expression") if expression is not None else None
    clean_equations = validate_equations(equations)

    if clean_expression is not None and clean_equations:
        if len(clean_equations) != 1 or clean_equations[0] != clean_expression:
            raise ValueError(
                "Provide either matching 'expression' or 'equations', not conflicting values for both."
            )

    if clean_expression is not None:
        clean_equations = [clean_expression]
        result_key = "expression"
        result_value: str | list[str] = clean_expression
    elif clean_equations:
        result_key = "equations"
        result_value = clean_equations
    else:
        raise ValueError("Field 'expression' is required for operation 'solve'.")

    namespace = build_symbol_table(clean_equations, variables)
    symbols = [namespace[variable] for variable in variables]
    parsed_equations = [_parse_equation(equation, namespace) for equation in clean_equations]

    try:
        raw_solutions = sp.solve(parsed_equations, symbols, dict=True)
    except Exception as exc:
        raise ValueError(f"Unable to solve the provided equations: {exc}") from exc

    solutions_by_variable: dict[str, list[str]] = {variable: [] for variable in variables}
    for solution in raw_solutions:
        for variable in variables:
            symbol = namespace[variable]
            if symbol in solution:
                solutions_by_variable[variable].append(sp.sstr(solution[symbol]))

    for variable, values in solutions_by_variable.items():
        unique_values = {value: parse_expression(value, namespace) for value in values}
        solutions_by_variable[variable] = sorted(
            unique_values,
            key=lambda item: sp.default_sort_key(unique_values[item]),
        )

    return {
        result_key: result_value,
        "solutions": solutions_by_variable,
        "variables": variables,
    }


def handle_calculus(
    expression: str | None,
    variables: list[str] | None,
    *,
    calculus_operation: object,
    limit_point: object = None,
) -> dict[str, object]:
    """Compute simple symbolic calculus operations on one variable."""
    if expression is None:
        raise ValueError("Field 'expression' is required for operation 'calculus'.")
    if not variables:
        raise ValueError("Field 'variables' is required for operation 'calculus'.")
    if len(variables) != 1:
        raise ValueError("Operation 'calculus' requires exactly one variable.")
    if not isinstance(calculus_operation, str) or not calculus_operation.strip():
        raise ValueError("Field 'calculus_operation' is required for operation 'calculus'.")

    clean_expression = validate_math_text(expression, "expression")
    if "=" in clean_expression:
        raise ValueError("Operation 'calculus' does not accept equations.")

    action = calculus_operation.strip().lower()
    if action not in {"derivative", "integral", "limit"}:
        raise ValueError(f"Unsupported calculus operation '{action}'.")

    namespace = build_symbol_table([clean_expression], variables)
    primary_variable = variables[0]
    symbol = namespace[primary_variable]
    parsed_expression = parse_expression(clean_expression, namespace)

    if action == "derivative":
        value = sp.diff(parsed_expression, symbol)
    elif action == "integral":
        value = sp.integrate(parsed_expression, symbol)
    else:
        if limit_point is None:
            raise ValueError("Field 'limit_point' is required for calculus operation 'limit'.")
        limit_value = parse_numeric_expression(limit_point, "limit_point")
        value = sp.limit(parsed_expression, symbol, limit_value)

    return {
        "calculus_operation": action,
        "expression": clean_expression,
        "value": sp.sstr(sp.simplify(value)),
        "variables": variables,
    }


def handle_matrix(
    *,
    matrix_a: object,
    matrix_operation: object,
    matrix_b: object = None,
) -> dict[str, object]:
    """Perform deterministic matrix operations on small numeric matrices."""
    if not isinstance(matrix_operation, str) or not matrix_operation.strip():
        raise ValueError("Field 'matrix_operation' is required for operation 'matrix'.")

    action = matrix_operation.strip().lower()
    if action not in {"determinant", "transpose", "inverse", "multiply"}:
        raise ValueError(f"Unsupported matrix operation '{action}'.")

    clean_matrix_a = validate_matrix(matrix_a, "matrix_a")
    matrix_a_sympy = sp.Matrix(clean_matrix_a)

    result: dict[str, object] = {
        "matrix_a": clean_matrix_a,
        "matrix_operation": action,
    }

    if action == "determinant":
        if matrix_a_sympy.rows != matrix_a_sympy.cols:
            raise ValueError("Operation 'determinant' requires a square matrix.")
        result["value"] = sp.sstr(matrix_a_sympy.det())
        return result

    if action == "transpose":
        result["value"] = matrix_to_result(matrix_a_sympy.T)
        return result

    if action == "inverse":
        if matrix_a_sympy.rows != matrix_a_sympy.cols:
            raise ValueError("Operation 'inverse' requires a square matrix.")
        if matrix_a_sympy.det() == 0:
            raise ValueError("Operation 'inverse' requires a non-singular matrix.")
        result["value"] = matrix_to_result(matrix_a_sympy.inv())
        return result

    clean_matrix_b = validate_matrix(matrix_b, "matrix_b")
    matrix_b_sympy = sp.Matrix(clean_matrix_b)
    if matrix_a_sympy.cols != matrix_b_sympy.rows:
        raise ValueError("Operation 'multiply' requires compatible matrix dimensions.")

    result["matrix_b"] = clean_matrix_b
    result["value"] = matrix_to_result(matrix_a_sympy * matrix_b_sympy)
    return result


def handle_statistics(*, values: object, statistic: object) -> dict[str, object]:
    """Compute descriptive statistics over a bounded numeric series."""
    if not isinstance(statistic, str) or not statistic.strip():
        raise ValueError("Field 'statistic' is required for operation 'statistics'.")

    action = statistic.strip().lower()
    if action not in {"mean", "median", "mode", "variance", "std", "min", "max"}:
        raise ValueError(f"Unsupported statistic '{action}'.")

    clean_values = validate_values(values)
    integer_series = all(isinstance(item, int) for item in clean_values)

    try:
        if integer_series:
            ordered_values = sorted(clean_values)
            if action == "mean":
                value = Fraction(sum(clean_values), len(clean_values))
            elif action == "median":
                midpoint = len(ordered_values) // 2
                if len(ordered_values) % 2:
                    value = ordered_values[midpoint]
                else:
                    value = Fraction(ordered_values[midpoint - 1] + ordered_values[midpoint], 2)
            elif action == "mode":
                modes = multimode(clean_values)
                if len(modes) != 1:
                    raise ValueError("Statistic 'mode' is ambiguous for multimodal input.")
                value = modes[0]
            elif action == "variance":
                value = population_variance_fraction(clean_values)
            elif action == "std":
                # Keep std as a numeric approximation so irrational results do not
                # widen the existing JSON contract beyond mean/median exact rationals.
                value = math.sqrt(float(population_variance_fraction(clean_values)))
            elif action == "min":
                value = min(clean_values)
            else:
                value = max(clean_values)
        else:
            series = [float(item) for item in clean_values]
            if action == "mean":
                value = mean(series)
            elif action == "median":
                value = median(series)
            elif action == "mode":
                modes = multimode(series)
                if len(modes) != 1:
                    raise ValueError("Statistic 'mode' is ambiguous for multimodal input.")
                value = float(modes[0])
            elif action == "variance":
                value = pvariance(series)
            elif action == "std":
                value = pstdev(series)
            elif action == "min":
                value = float(min(series))
            else:
                value = float(max(series))
    except StatisticsError as exc:
        raise ValueError(f"Unable to compute statistic '{action}': {exc}") from exc

    return {
        "count": len(clean_values),
        "statistic": action,
        "value": serialize_statistic_value(value),
        "values": clean_values,
    }


def handle_units(
    expression: str | None,
    *,
    from_unit: object,
    to_unit: object,
) -> dict[str, object]:
    """Convert numeric quantities between units with Pint."""
    if expression is None:
        raise ValueError("Field 'expression' is required for operation 'units'.")

    try:
        from pint import DimensionalityError, UndefinedUnitError
    except ModuleNotFoundError as exc:  # pragma: no cover - environment-dependent
        raise RuntimeError("Unit conversion requires the 'pint' package.") from exc

    clean_from_unit = validate_unit_text(from_unit if isinstance(from_unit, str) else None, "from_unit")
    clean_to_unit = validate_unit_text(to_unit if isinstance(to_unit, str) else None, "to_unit")
    magnitude = float(parse_numeric_expression(expression, "expression"))
    unit_registry = get_unit_registry()

    try:
        converted = (magnitude * unit_registry(clean_from_unit)).to(clean_to_unit)
    except DimensionalityError as exc:
        raise ValueError(f"Cannot convert from '{clean_from_unit}' to '{clean_to_unit}'.") from exc
    except UndefinedUnitError as exc:
        raise ValueError(f"Unknown unit in conversion: {exc}.") from exc

    return {
        "from_unit": clean_from_unit,
        "to_unit": clean_to_unit,
        "value": float(converted.magnitude),
    }


def handle_plot(
    expression: str | None,
    variables: list[str] | None,
    *,
    plot_x_min: object,
    plot_x_max: object,
    plot_points: object = None,
    plot_title: object = None,
) -> dict[str, object]:
    """Render a deterministic plot and return artifact payload plus public metadata."""
    if expression is None:
        raise ValueError("Field 'expression' is required for operation 'plot'.")
    if not variables:
        raise ValueError("Field 'variables' is required for operation 'plot'.")
    if len(variables) != 1:
        raise ValueError("Operation 'plot' requires exactly one variable.")
    if plot_x_min is None:
        raise ValueError("Field 'plot_x_min' is required for operation 'plot'.")
    if plot_x_max is None:
        raise ValueError("Field 'plot_x_max' is required for operation 'plot'.")

    clean_expression = validate_math_text(expression, "expression")
    if "=" in clean_expression:
        raise ValueError("Operation 'plot' does not accept equations.")

    clean_plot_title = validate_plot_title(plot_title)
    samples = validate_plot_points(plot_points)
    x_min_value = float(parse_numeric_expression(plot_x_min, "plot_x_min"))
    x_max_value = float(parse_numeric_expression(plot_x_max, "plot_x_max"))
    if x_max_value <= x_min_value:
        raise ValueError("Field 'plot_x_max' must be greater than 'plot_x_min'.")

    namespace = build_symbol_table([clean_expression], variables)
    variable_name = variables[0]
    symbol = namespace[variable_name]
    parsed_expression = parse_expression(clean_expression, namespace)

    step = (x_max_value - x_min_value) / (samples - 1)
    x_values = [x_min_value + step * index for index in range(samples)]
    y_values: list[float] = []
    finite_points = 0

    for x_value in x_values:
        try:
            evaluated = sp.N(parsed_expression.subs(symbol, sp.Float(x_value)))
            if evaluated.free_symbols:
                y_values.append(float("nan"))
                continue
            if evaluated.has(sp.zoo, sp.oo, -sp.oo, sp.nan):
                y_values.append(float("nan"))
                continue
            if evaluated.is_real is False:
                y_values.append(float("nan"))
                continue
            numeric_value = float(evaluated)
            if not math.isfinite(numeric_value):
                y_values.append(float("nan"))
                continue
            y_values.append(numeric_value)
            finite_points += 1
        except Exception:
            y_values.append(float("nan"))

    if finite_points == 0:
        raise ValueError("Plot expression did not produce any finite values over the requested range.")

    try:
        import matplotlib

        matplotlib.use("Agg", force=True)
        from matplotlib import pyplot as plt
    except ModuleNotFoundError as exc:  # pragma: no cover - environment-dependent
        raise RuntimeError("Plot generation requires the 'matplotlib' package.") from exc

    figure, axis = plt.subplots(figsize=(6, 4), dpi=100)
    axis.plot(x_values, y_values, color="#1f77b4", linewidth=2.0)
    axis.axhline(0.0, color="#666666", linewidth=0.8)
    axis.axvline(0.0, color="#666666", linewidth=0.8)
    axis.grid(True, color="#d9d9d9", linewidth=0.8)
    axis.set_xlabel(variable_name)
    axis.set_ylabel("f(x)")
    axis.set_xlim(x_min_value, x_max_value)
    axis.set_title(clean_plot_title or f"Plot of {clean_expression}")
    figure.tight_layout()

    buffer = BytesIO()
    try:
        figure.savefig(
            buffer,
            format="png",
            metadata={"Software": "advanced_math_tool"},
        )
    finally:
        plt.close(figure)

    artifact_title = make_plot_artifact_title(clean_plot_title, clean_expression)
    artifact_content = base64.b64encode(buffer.getvalue()).decode("ascii")

    return {
        "_artifact_content": artifact_content,
        "_artifact_title": artifact_title,
        "expression": clean_expression,
        "plot": {
            "points": samples,
            "title": clean_plot_title or f"Plot of {clean_expression}",
            "variable": variable_name,
            "x_max": x_max_value,
            "x_min": x_min_value,
        },
        "variables": variables,
    }
