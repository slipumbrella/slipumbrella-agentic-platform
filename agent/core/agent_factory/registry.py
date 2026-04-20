"""
AgentRegistry — maps role names to template functions.

Templates are registered via the ``@AgentRegistry.register`` decorator in
``templates.py``, which is imported as a side-effect in ``factory.py``.
"""

from __future__ import annotations

from typing import Callable, Optional


class AgentRegistry:
    """Class-level registry mapping role names → (template_func, tool_refs)."""

    _registry: dict[str, dict] = {}

    @classmethod
    def register(cls, name: str, tool_refs: Optional[list[str]] = None) -> Callable:
        """Decorator that registers a template function under *name*."""
        def decorator(fn: Callable) -> Callable:
            cls._registry[name] = {"template": fn, "tool_refs": tool_refs or []}
            return fn
        return decorator

    @classmethod
    def get(cls, name: str) -> Optional[Callable]:
        """Return the template callable for *name*, or ``None`` if not found."""
        entry = cls._registry.get(name)
        return entry["template"] if entry else None

    @classmethod
    def get_tool_refs(cls, name: str) -> list[str]:
        """Return the list of default tool names for *name*, or ``[]``."""
        entry = cls._registry.get(name)
        return entry.get("tool_refs", []) if entry else []

    @classmethod
    def list_roles(cls) -> list[str]:
        """Return all registered role names."""
        return list(cls._registry.keys())

