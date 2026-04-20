import logging
from typing import Awaitable, Callable

from agent_framework import AgentContext, AgentMiddleware


class LoggingMiddleware(AgentMiddleware):
    """Logs agent invocation start and finish for observability."""

    def __init__(self) -> None:
        self.logger = logging.getLogger(__name__)

    async def process(
        self,
        context: AgentContext,
        call_next: Callable[[], Awaitable[None]],
    ) -> None:
        agent_name = getattr(context.agent, "name", "unknown")
        msg_count = len(context.messages) if context.messages else 0
        self.logger.info(
            "Agent '%s' invoked with %d message(s).", agent_name, msg_count
        )
        try:
            await call_next()
        except Exception as exc:
            self.logger.error(
                "Agent '%s' raised an error: %s", agent_name, exc, exc_info=True
            )
            raise
        self.logger.info("Agent '%s' finished.", agent_name)


# Keep old name as alias for backwards compatibility with any remaining references
LoggingObserver = LoggingMiddleware
