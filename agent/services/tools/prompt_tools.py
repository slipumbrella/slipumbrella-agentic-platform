import asyncio
import logging
import json
import time
from typing import Annotated, Optional, Any

import httpx
from pydantic import BaseModel, Field
from agent_framework import tool
from openai import APIConnectionError, APIStatusError, APITimeoutError, AsyncOpenAI
from agent.core.llm_config import get_llm_config

logger = logging.getLogger(__name__)

_PROMPT_TOOL_TIMEOUT = httpx.Timeout(connect=5.0, read=110.0, write=10.0, pool=10.0)
_PROMPT_TOOL_HARD_TIMEOUT_SECONDS = 120.0

class AgentPromptSpec(BaseModel):
    agent_id: Annotated[str, Field(description="A unique identifier for this agent (e.g., 'researcher_1').")]
    mission: Annotated[str, Field(description="The primary purpose or role of the agent to generate a prompt for.")]
    group_context: Annotated[Optional[str], Field(description="Background information about the team or environment.")] = None
    tone: Annotated[str, Field(description="The desired personality (e.g. Professional, Friendly, Witty).")] = "Professional"
    constraints: Annotated[Optional[list[str]], Field(description="A list of strict guardrails or things the agent should avoid.")] = None

class BatchPromptOptimizerInput(BaseModel):
    agents: Annotated[list[AgentPromptSpec], Field(description="List of agent specifications to generate prompts for in one batch.")]

@tool(
    name="generate_batch_optimized_prompts",
    description="Uses a world-class meta-prompt to generate production-grade agent personas and instructions for MULTIPLE agents simultaneously.",
    schema=BatchPromptOptimizerInput,
)
async def generate_batch_optimized_prompts_tool(
    agents: list[AgentPromptSpec | dict[str, Any]],
    **kwargs: object,
) -> str:
    """Generates optimized prompts for multiple agents using a batch process."""
    if not agents:
        return "{}"

    parsed_agents: list[AgentPromptSpec] = []
    for a in agents:
        if isinstance(a, dict):
            try:
                parsed_agents.append(AgentPromptSpec(**a))
            except Exception as e:
                logger.error(f"Failed to parse AgentPromptSpec: {e}")
                return json.dumps({"error": f"Invalid agent format: {e}"})
        else:
            parsed_agents.append(a)

    cfg = get_llm_config()
    client = AsyncOpenAI(
        api_key=cfg.api_key,
        base_url=cfg.base_url,
        timeout=_PROMPT_TOOL_TIMEOUT,
        max_retries=0,
    )

    from agent.prompts.meta_prompt import BATCH_META_PROMPT

    # Format the input data cleanly
    agents_data_str = ""
    for spec in parsed_agents:
        safe_mission = spec.mission.replace("{", "{{").replace("}", "}}")
        safe_context = (spec.group_context or "").replace("{", "{{").replace("}", "}}")
        safe_tone = spec.tone.replace("{", "{{").replace("}", "}}")
        safe_constraints = [c.replace("{", "{{").replace("}", "}}") for c in (spec.constraints or [])]
        
        agents_data_str += f"- **Agent ID**: {spec.agent_id}\n"
        agents_data_str += f"  - Mission: {safe_mission}\n"
        agents_data_str += f"  - Context: {safe_context or 'General purpose'}\n"
        agents_data_str += f"  - Tone: {safe_tone}\n"
        agents_data_str += f"  - Constraints: {', '.join(safe_constraints) if safe_constraints else 'Standard safety'}\n\n"

    started_at = time.perf_counter()
    try:
        async with asyncio.timeout(_PROMPT_TOOL_HARD_TIMEOUT_SECONDS):
            response = await client.chat.completions.create(
                model=cfg.model,
                messages=[
                    {"role": "system", "content": BATCH_META_PROMPT},
                    {"role": "user", "content": f"Here is the batch of agents to optimize:\n\n{agents_data_str}"},
                ],
                temperature=0.7,
                response_format={"type": "json_object"},
            )

        content = response.choices[0].message.content
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        request_id = getattr(response, "_request_id", None)
        logger.info(
            "Batch prompt optimization completed in %sms for %s agents (model=%s, request_id=%s)",
            elapsed_ms,
            len(parsed_agents),
            cfg.model,
            request_id or "n/a",
        )
        return content or "{}"
    except TimeoutError:
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.warning(
            "Batch prompt optimization timed out after %sms for %s agents (model=%s)",
            elapsed_ms,
            len(parsed_agents),
            cfg.model,
        )
        return json.dumps({"error": "Prompt generation timed out"})
    except APITimeoutError as exc:
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.warning(
            "Batch prompt optimization API timeout after %sms for %s agents (model=%s): %s",
            elapsed_ms,
            len(parsed_agents),
            cfg.model,
            exc,
        )
        return json.dumps({"error": "Prompt generation timed out"})
    except APIStatusError as exc:
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.error(
            "Batch prompt optimization API status failure after %sms (status=%s, request_id=%s): %s",
            elapsed_ms,
            exc.status_code,
            exc.request_id or "n/a",
            exc,
        )
        return json.dumps({"error": f"Prompt generation failed with status {exc.status_code}"})
    except APIConnectionError as exc:
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.error(
            "Batch prompt optimization connection failure after %sms: %s",
            elapsed_ms,
            exc,
        )
        return json.dumps({"error": "Prompt generation connection failed"})
    except Exception as exc:
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        logger.exception(
            "Batch prompt optimization failed after %sms: %s",
            elapsed_ms,
            exc,
        )
        return json.dumps({"error": str(exc)})
    finally:
        await client.close()
