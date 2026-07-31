"""
app/core/ensemble.py
--------------------
ModelEnsemble — A transparent multi-model ensemble layer.

Wraps multiple LangChain chat model instances and exposes the same
.ainvoke() / .invoke() / .with_structured_output() interface so that
all agent nodes require zero structural changes.

Strategies
----------
fallback : Try models in order (primary → fallback …); return on first success.
           Cloud-first, local-fallback is the standard setup in this project.

race     : Fire all models concurrently; return the first successful response
           and cancel the remaining tasks immediately. Best for latency-critical
           paths (e.g., parallel cell generation) where any correct answer wins.

vote     : Fire all models concurrently; apply majority vote on boolean fields
           of the Pydantic schema. Falls back to the primary model's result for
           complex / list fields where voting is ambiguous. Most useful for
           binary decisions (e.g., prompt validation guardrails).
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional, Tuple, Type

from pydantic import BaseModel

logger = logging.getLogger(__name__)

# (human-readable name, LangChain chat model instance)
ModelEntry = Tuple[str, Any]


# ---------------------------------------------------------------------------
# StructuredEnsemble
# ---------------------------------------------------------------------------

class StructuredEnsemble:
    """
    Returned by ModelEnsemble.with_structured_output().

    Mirrors the interface of a LangChain structured-output Runnable:
      .invoke(prompt)   → Pydantic model instance  (sync)
      .ainvoke(prompt)  → Pydantic model instance  (async)
    """

    def __init__(
        self,
        models: List[ModelEntry],
        strategy: str,
        schema: Type[BaseModel],
    ) -> None:
        self._raw_models = models
        self._strategy = strategy
        self._schema = schema

        # Build structured runnables eagerly so any config errors surface early
        self._runnables: List[ModelEntry] = [
            (name, model.with_structured_output(schema))
            for name, model in models
        ]

    # ------------------------------------------------------------------ sync

    def invoke(self, prompt: Any) -> Any:
        """
        Synchronous invocation. Always uses sequential fallback so that the
        caller does not need to manage an event loop. Vote / race effects only
        apply in the async path.
        """
        return self._fallback_sync(prompt)

    def _fallback_sync(self, prompt: Any) -> Any:
        last_exc: Optional[Exception] = None
        for name, runnable in self._runnables:
            try:
                t0 = time.monotonic()
                result = runnable.invoke(prompt)
                logger.info(
                    "[Ensemble:structured/%s] '%s' responded in %.2fs",
                    self._strategy, name, time.monotonic() - t0,
                )
                return result
            except Exception as exc:
                logger.warning(
                    "[Ensemble:structured/%s] '%s' failed (%s). Trying next model…",
                    self._strategy, name, exc,
                )
                last_exc = exc

        raise RuntimeError(
            f"All models failed for structured output "
            f"({self._schema.__name__}): {last_exc}"
        )

    # ----------------------------------------------------------------- async

    async def ainvoke(self, prompt: Any) -> Any:
        if self._strategy == "race":
            return await self._race_async(prompt)
        if self._strategy == "vote":
            return await self._vote_async(prompt)
        return await self._fallback_async(prompt)

    async def _fallback_async(self, prompt: Any) -> Any:
        last_exc: Optional[Exception] = None
        for name, runnable in self._runnables:
            try:
                t0 = time.monotonic()
                result = await runnable.ainvoke(prompt)
                logger.info(
                    "[Ensemble:structured/fallback] '%s' responded in %.2fs",
                    name, time.monotonic() - t0,
                )
                return result
            except Exception as exc:
                logger.warning(
                    "[Ensemble:structured/fallback] '%s' failed (%s). Falling back…",
                    name, exc,
                )
                last_exc = exc

        raise RuntimeError(
            f"All models failed for structured fallback "
            f"({self._schema.__name__}): {last_exc}"
        )

    async def _race_async(self, prompt: Any) -> Any:
        """
        Fire all structured runnables concurrently.
        The first to succeed wins; all others are cancelled and awaited for
        clean shutdown.
        """
        tasks: Dict[asyncio.Task, str] = {
            asyncio.create_task(runnable.ainvoke(prompt)): name
            for name, runnable in self._runnables
        }
        pending = set(tasks.keys())
        last_exc: Optional[Exception] = None

        while pending:
            done, pending = await asyncio.wait(
                pending, return_when=asyncio.FIRST_COMPLETED
            )
            for task in done:
                name = tasks[task]
                exc = task.exception()
                if exc is None:
                    logger.info(
                        "[Ensemble:structured/race] '%s' won the race.", name
                    )
                    for p in pending:
                        p.cancel()
                    if pending:
                        await asyncio.gather(*pending, return_exceptions=True)
                    return task.result()
                else:
                    logger.warning(
                        "[Ensemble:structured/race] '%s' failed: %s", name, exc
                    )
                    last_exc = exc

        raise RuntimeError(
            f"All models failed in structured race "
            f"({self._schema.__name__}): {last_exc}"
        )

    async def _vote_async(self, prompt: Any) -> Any:
        """
        Fire all structured runnables concurrently and apply majority vote.

        Voting logic:
        - Boolean fields  → majority vote (True if > half of responders say True)
        - All other fields → primary model's value (first successful responder)

        If only one model responds, its result is used directly.
        """
        coros = [runnable.ainvoke(prompt) for _, runnable in self._runnables]
        raw = await asyncio.gather(*coros, return_exceptions=True)

        successful: List[Tuple[str, Any]] = []
        for (name, _), result in zip(self._runnables, raw):
            if isinstance(result, Exception):
                logger.warning(
                    "[Ensemble:structured/vote] '%s' failed: %s", name, result
                )
            else:
                successful.append((name, result))

        if not successful:
            raise RuntimeError(
                f"All models failed in vote ensemble ({self._schema.__name__})"
            )

        if len(successful) == 1:
            logger.info(
                "[Ensemble:structured/vote] Only '%s' responded; using its result.",
                successful[0][0],
            )
            return successful[0][1]

        # Primary model's result is the merge base
        primary_name, primary_result = successful[0]
        merged = primary_result.model_copy(deep=True)

        # Majority-vote on boolean fields only
        for field_name, field_info in self._schema.model_fields.items():
            if field_info.annotation is bool:
                votes = [getattr(r, field_name) for _, r in successful]
                majority_value = sum(votes) > len(votes) / 2
                setattr(merged, field_name, majority_value)
                logger.info(
                    "[Ensemble:vote] Field '%s': model_votes=%s → majority=%s",
                    field_name,
                    dict(zip([n for n, _ in successful], votes)),
                    majority_value,
                )

        logger.info(
            "[Ensemble:structured/vote] Merged result from %d models (primary: '%s').",
            len(successful), primary_name,
        )
        return merged


# ---------------------------------------------------------------------------
# ModelEnsemble
# ---------------------------------------------------------------------------

class ModelEnsemble:
    """
    Transparent multi-model wrapper that mirrors the LangChain BaseChatModel
    interface. Drop-in replacement for any ChatModel instance.

    Parameters
    ----------
    models   : Ordered list of (name, chat_model) pairs.
               For 'fallback', the first model is the primary (cloud);
               subsequent entries are fallbacks (local Ollama).
    strategy : "fallback" | "race" | "vote"
    label    : Short identifier used in log messages.

    Example
    -------
    ensemble = ModelEnsemble(
        models=[("openrouter", cloud_llm), ("ollama", local_llm)],
        strategy="fallback",
        label="architect",
    )
    response = await ensemble.ainvoke("Write a DEAP crossover function.")
    result   = ensemble.with_structured_output(MySchema).invoke(prompt)
    """

    def __init__(
        self,
        models: List[ModelEntry],
        strategy: str = "fallback",
        label: str = "ensemble",
    ) -> None:
        if not models:
            raise ValueError("ModelEnsemble requires at least one model.")
        self._models = models
        self._strategy = strategy
        self._label = label

    # -------------------------------------------------------------- public API

    def with_structured_output(self, schema: Type[BaseModel]) -> StructuredEnsemble:
        """Returns a StructuredEnsemble that applies the same strategy."""
        return StructuredEnsemble(self._models, self._strategy, schema)

    async def ainvoke(self, prompt: Any) -> Any:
        """Async invocation — strategy applied here for free-form text."""
        if self._strategy == "race":
            return await self._race_async(prompt)
        # fallback and vote both use sequential fallback for free-form responses
        return await self._fallback_async(prompt)

    def invoke(self, prompt: Any) -> Any:
        """Sync invocation — always sequential fallback."""
        return self._fallback_sync(prompt)

    # ------------------------------------------------------------------- sync

    def _fallback_sync(self, prompt: Any) -> Any:
        last_exc: Optional[Exception] = None
        for name, model in self._models:
            try:
                t0 = time.monotonic()
                result = model.invoke(prompt)
                logger.info(
                    "[Ensemble:%s/fallback] '%s' responded in %.2fs",
                    self._label, name, time.monotonic() - t0,
                )
                return result
            except Exception as exc:
                logger.warning(
                    "[Ensemble:%s/fallback] '%s' failed (%s). Falling back…",
                    self._label, name, exc,
                )
                last_exc = exc

        raise RuntimeError(
            f"[Ensemble:{self._label}] All models failed: {last_exc}"
        )

    # ------------------------------------------------------------------ async

    async def _fallback_async(self, prompt: Any) -> Any:
        last_exc: Optional[Exception] = None
        for name, model in self._models:
            try:
                t0 = time.monotonic()
                result = await model.ainvoke(prompt)
                logger.info(
                    "[Ensemble:%s/fallback] '%s' responded in %.2fs",
                    self._label, name, time.monotonic() - t0,
                )
                return result
            except Exception as exc:
                logger.warning(
                    "[Ensemble:%s/fallback] '%s' failed (%s). Falling back…",
                    self._label, name, exc,
                )
                last_exc = exc

        raise RuntimeError(
            f"[Ensemble:{self._label}] All models failed: {last_exc}"
        )

    async def _race_async(self, prompt: Any) -> Any:
        """
        Fire all models concurrently. Return the first successful response
        and cancel all remaining tasks (with graceful cleanup).
        """
        tasks: Dict[asyncio.Task, str] = {
            asyncio.create_task(model.ainvoke(prompt)): name
            for name, model in self._models
        }
        pending = set(tasks.keys())
        last_exc: Optional[Exception] = None

        while pending:
            done, pending = await asyncio.wait(
                pending, return_when=asyncio.FIRST_COMPLETED
            )
            for task in done:
                name = tasks[task]
                exc = task.exception()
                if exc is None:
                    logger.info(
                        "[Ensemble:%s/race] '%s' won the race.",
                        self._label, name,
                    )
                    # Cancel remaining tasks and wait for clean shutdown
                    for p in pending:
                        p.cancel()
                    if pending:
                        await asyncio.gather(*pending, return_exceptions=True)
                    return task.result()
                else:
                    logger.warning(
                        "[Ensemble:%s/race] '%s' failed: %s",
                        self._label, name, exc,
                    )
                    last_exc = exc

        raise RuntimeError(
            f"[Ensemble:{self._label}] All models failed in race: {last_exc}"
        )
