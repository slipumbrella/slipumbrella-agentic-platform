import asyncio
import json as _json
import logging
from typing import List, Optional, Type

from pydantic import BaseModel, Field
from openai import AsyncOpenAI

from agent.configs.settings import settings
from agent.prompts.evaluation import BATCH_JUDGE_SYSTEM_PROMPT, BATCH_SYNTH_SYSTEM_PROMPT
from agent.db.repositories.embedding_repository import EmbeddingRepository
from agent.services.embedding_service import embedding_service

logger = logging.getLogger(__name__)

METRIC_THRESHOLD = 0.8
MAX_PARALLEL = 20
JSON_PARSE_RETRIES = 2

# ---------------------------------------------------------------------------
# Judge Models & Prompts
# ---------------------------------------------------------------------------

class JudgeMetricResult(BaseModel):
    score: float = Field(..., ge=0, le=1)
    reason: str

class SingleTestScore(BaseModel):
    test_id: str
    answer_relevancy: JudgeMetricResult
    faithfulness: JudgeMetricResult
    contextual_relevancy: JudgeMetricResult

class BatchScoringResponse(BaseModel):
    results: List[SingleTestScore]

class SingleGolden(BaseModel):
    test_id: str
    session_name: str = ""
    input: str
    expected_output: str

class BatchSynthesisResponse(BaseModel):
    goldens: List[SingleGolden]

# ---------------------------------------------------------------------------
# OpenAI Judge: AsyncOpenAI + Strict JSON Schema
# ---------------------------------------------------------------------------

class RAGJudge:
    def __init__(self):
        self.client = AsyncOpenAI(
            api_key=settings.OPENROUTER_API_KEY,
            base_url=settings.OPENROUTER_BASE_URL,
            default_headers={
                "HTTP-Referer": "https://slipumbrella.com",
                "X-Title": "RAG evaluator",
            },
            timeout=90.0,  # 90-second hard cap per API call; prevents hangs
        )
        self._semaphore = asyncio.Semaphore(MAX_PARALLEL)
        self.model = settings.JUDGE_MODEL

    @staticmethod
    def _extract_json_payload(raw: Optional[str]) -> dict:
        if not raw or not raw.strip():
            raise ValueError("Empty response content from judge model")

        content = raw.strip()

        if content.startswith("```"):
            lines = content.splitlines()
            if len(lines) >= 3 and lines[-1].strip() == "```":
                content = "\n".join(lines[1:-1]).strip()

        try:
            return _json.loads(content)
        except _json.JSONDecodeError:
            start = content.find("{")
            end = content.rfind("}")
            if start >= 0 and end > start:
                return _json.loads(content[start : end + 1])
            raise

    async def a_generate_json(self, system_prompt: str, user_prompt: str, schema: Type[BaseModel]) -> BaseModel:
        last_error: Exception | None = None

        for attempt in range(1, JSON_PARSE_RETRIES + 1):
            async with self._semaphore:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    response_format={"type": "json_object"},
                    temperature=0,
                )

            raw = response.choices[0].message.content
            finish_reason = response.choices[0].finish_reason

            try:
                payload = self._extract_json_payload(raw)
                return schema.model_validate(payload)
            except Exception as exc:
                last_error = exc
                snippet = (raw or "").strip().replace("\n", "\\n")[:180]
                logger.warning(
                    "Judge JSON parse failed (attempt %s/%s, model=%s, finish_reason=%s): %s | raw=%r",
                    attempt,
                    JSON_PARSE_RETRIES,
                    self.model,
                    finish_reason,
                    exc,
                    snippet,
                )

        if last_error is not None:
            raise last_error

        raise RuntimeError("Judge JSON generation failed without exception")

    async def aclose(self) -> None:
        """Close underlying async HTTP resources."""
        await self.client.close()

# ---------------------------------------------------------------------------
# RAG Evaluator (High Performance Core)
# ---------------------------------------------------------------------------

class RAGEvaluator:
    def __init__(self, embedding_repository: Optional[EmbeddingRepository] = None) -> None:
        self.judge = RAGJudge()
        self.embedding_repository = embedding_repository

    def evaluate_documents(
        self, 
        documents: List[dict], 
        session_id: str = "",
        session_name: str = "",
        session_description: str = "",
        agent_roles: List[str] = None
    ) -> dict:
        async def _run() -> dict:
            try:
                return await self.evaluate_documents_async(
                    documents,
                    session_id,
                    session_name,
                    session_description,
                    agent_roles,
                )
            finally:
                await self.aclose()

        return asyncio.run(_run())

    async def aclose(self) -> None:
        """Close evaluator resources for the current request."""
        await self.judge.aclose()

    async def evaluate_documents_async(
        self, 
        documents: List[dict], 
        session_id: str = "",
        session_name: str = "",
        session_description: str = "",
        agent_roles: List[str] = None
    ) -> dict:
        if not documents:
            return self._failed("No documents provided")
            
        # Dynamic batch size based on document count to optimize throughput
        # Using larger batches significantly reduces the number of LLM calls.
        count = len(documents)
        if count < 10:
            batch_size = 3
        elif count < 50:
            batch_size = 10
        else:
            batch_size = 20
            
        batches = [documents[i:i + batch_size] for i in range(0, count, batch_size)]
        tasks = [
            self._process_batch(batch, f"b{i}", session_id, session_name, session_description, agent_roles) 
            for i, batch in enumerate(batches)
        ]
        all_batch_results = await asyncio.gather(*tasks)
        
        results = [res for batch_res in all_batch_results for res in batch_res if res]
        return self._aggregate(results)

    async def _process_batch(
        self, 
        batch: List[dict], 
        batch_id: str, 
        session_id: str = "",
        session_name: str = "",
        session_description: str = "",
        agent_roles: List[str] = None
    ) -> List[SingleTestScore]:
        # 1. Synthesis Batch
        goldens = await self._synthesize_batch(batch, batch_id, session_id, session_name, session_description, agent_roles)
        if not goldens:
            return []

        # 2. Scoring Batch
        return await self._score_batch(goldens, batch_id, session_name, session_description, agent_roles)

    async def _synthesize_batch(
        self, 
        batch: List[dict], 
        batch_id: str, 
        session_id: str = "",
        session_name: str = "",
        session_description: str = "",
        agent_roles: List[str] = None
    ) -> List[dict]:
        contexts = []
        for i, doc in enumerate(batch):
            content = doc.get("content", "").strip()
            if content:
                contexts.append({"test_id": f"{batch_id}_t{i}", "content": content})
        
        if not contexts:
            return []

        prompt = "Generate one question-answer pair for each context block below.\n\n"
        for c in contexts:
            prompt += f"Context ID: {c['test_id']}\n{c['content']}\n---\n"
        
        try:
            # Inject context into system prompt if available
            system_prompt = BATCH_SYNTH_SYSTEM_PROMPT
            if session_name or session_description or agent_roles:
                context_header = "\n\n## Project Context for this Evaluation\n"
                if session_name:
                    context_header += f"- **Target System**: {session_name}\n"
                if session_description:
                    context_header += f"- **Project Purpose**: {session_description}\n"
                if agent_roles:
                    context_header += f"- **Involved Specialized Agents**: {', '.join(agent_roles)}\n"
                system_prompt = context_header + system_prompt

            resp = await self.judge.a_generate_json(system_prompt, prompt, BatchSynthesisResponse)
            id_map = {c['test_id']: c['content'] for c in contexts}
            
            # Step 1: Batch generate embeddings for all synthesized questions
            # This is a "superpower" optimization to reduce sequential API calls.
            questions = [g.input for g in resp.goldens]
            vectors = []
            if questions and session_id:
                try:
                    vectors = await embedding_service.embed_queries(session_id, questions)
                    logger.debug(f"Generated {len(vectors)} embeddings for batch {batch_id}")
                except Exception as e:
                    logger.warning(f"Batch embedding failed for {batch_id}: {e}")

            # Step 2: Parallelize vector database searches
            async def fetch_context(g_idx: int, g_item: SingleGolden) -> List[str]:
                fallback = [id_map.get(g_item.test_id, "")]
                if not session_id:
                    return fallback
                if self.embedding_repository is None:
                    logger.warning(
                        "RAG retrieval skipped for test %s because no embedding repository was configured",
                        g_item.test_id,
                    )
                    return fallback
                
                try:
                    # Use pre-generated vector if available, otherwise fallback to individual embed
                    vec = vectors[g_idx] if g_idx < len(vectors) else await embedding_service.embed_query(session_id, g_item.input)
                    retrieved = await self.embedding_repository.search_similar_chunks(session_id, vec, top_k=5)
                    return retrieved if retrieved else fallback
                except Exception as e:
                    logger.warning(f"RAG retrieval failed for test {g_item.test_id}: {e}")
                    return fallback

            # Create and gather search tasks
            search_tasks = [fetch_context(i, g) for i, g in enumerate(resp.goldens)]
            all_retrievals = await asyncio.gather(*search_tasks)

            # Step 3: Map results back to goldens
            goldens_out = []
            for i, g in enumerate(resp.goldens):
                goldens_out.append({
                    "test_id": g.test_id,
                    "session_name": g.session_name,
                    "input": g.input,
                    "actual_output": g.expected_output,
                    "retrieval_context": all_retrievals[i],
                })
            return goldens_out
        except Exception as e:
            logger.error(f"Synthesis failed for {batch_id}: {e}")
            return []

    async def _score_batch(
        self, 
        goldens: List[dict], 
        batch_id: str,
        session_name: str = "",
        session_description: str = "",
        agent_roles: List[str] = None
    ) -> List[SingleTestScore]:
        prompt = "Evaluate the following test cases:\n\n"
        for g in goldens:
            prompt += (
                f"Test ID: {g['test_id']}\n"
                f"Question: {g['input']}\n"
                f"Answer: {g['actual_output']}\n"
                f"Context: {g['retrieval_context'][0][:2000]}\n"
                f"---\n"
            )
        
        try:
            # Inject context into system prompt if available
            system_prompt = BATCH_JUDGE_SYSTEM_PROMPT
            if session_name or session_description or agent_roles:
                context_header = "\n\n## Project Context for this Evaluation\n"
                if session_name:
                    context_header += f"- **Target System**: {session_name}\n"
                if session_description:
                    context_header += f"- **Project Purpose**: {session_description}\n"
                if agent_roles:
                    context_header += f"- **Involved Specialized Agents**: {', '.join(agent_roles)}\n"
                system_prompt = context_header + system_prompt

            resp = await self.judge.a_generate_json(system_prompt, prompt, BatchScoringResponse)
            return resp.results
        except Exception as e:
            logger.error(f"Scoring failed for {batch_id}: {e}")
            return []

    def _aggregate(self, scores: List[SingleTestScore]) -> dict:
        if not scores:
            return {"overall_score": 0.0, "metrics": [], "test_cases_count": 0, "status": "failed", "error_message": "No valid scores"}

        def avg_metric(name: str):
            vals = [getattr(s, name).score for s in scores]
            return sum(vals) / len(vals)

        def worst_reason(name: str) -> str:
            worst = min(scores, key=lambda s: getattr(s, name).score)
            return getattr(worst, name).reason

        metrics = [
            {
                "metric_name": "AnswerRelevancy",
                "score": round(avg_metric("answer_relevancy"), 4),
                "passed": avg_metric("answer_relevancy") >= METRIC_THRESHOLD,
                "reason": worst_reason("answer_relevancy"),
            },
            {
                "metric_name": "Faithfulness",
                "score": round(avg_metric("faithfulness"), 4),
                "passed": avg_metric("faithfulness") >= METRIC_THRESHOLD,
                "reason": worst_reason("faithfulness"),
            },
            {
                "metric_name": "ContextualRelevancy",
                "score": round(avg_metric("contextual_relevancy"), 4),
                "passed": avg_metric("contextual_relevancy") >= METRIC_THRESHOLD,
                "reason": worst_reason("contextual_relevancy"),
            },
        ]
        
        overall = sum(m["score"] for m in metrics) / 3 * 100
        return {
            "overall_score": round(overall, 1),
            "metrics": metrics,
            "test_cases_count": len(scores),
            "status": "completed",
            "error_message": "",
        }

    @staticmethod
    def _failed(message: str) -> dict:
        return {"overall_score": 0.0, "metrics": [], "test_cases_count": 0, "status": "failed", "error_message": message}
