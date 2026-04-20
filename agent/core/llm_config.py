from dataclasses import dataclass

from agent.configs.settings import settings


@dataclass(frozen=True)
class LLMConfig:
    """Immutable configuration for the LLM client."""
    api_key: str
    model: str
    base_url: str

def get_llm_config() -> LLMConfig:
    """Return the LLM configuration sourced from application settings."""
    return LLMConfig(
        api_key=settings.OPENROUTER_API_KEY,
        model=settings.CORE_MODEL,
        base_url=settings.OPENROUTER_BASE_URL,
    )
