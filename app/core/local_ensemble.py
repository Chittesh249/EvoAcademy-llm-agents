import os
import logging
import time
from dotenv import load_dotenv
from langchain_ollama import ChatOllama

load_dotenv()
logger = logging.getLogger(__name__)

class StructuredFallbackWrapper:
    def __init__(self, models, schema):
        # Eagerly prepare the structured output runnables
        self._runnables = [
            (name, model.with_structured_output(schema)) 
            for name, model in models
        ]
        self._schema = schema
        
    def invoke(self, prompt):
        last_exception = None
        for name, runnable in self._runnables:
            try:
                start_time = time.monotonic()
                result = runnable.invoke(prompt)
                logger.info(f"[LocalEnsemble:structured] '{name}' responded in {time.monotonic() - start_time:.2f}s")
                return result
            except Exception as exc:
                logger.warning(f"[LocalEnsemble:structured] '{name}' failed ({exc}). Trying next...")
                last_exception = exc
                
        raise RuntimeError(f"All models failed for structured output ({self._schema.__name__}): {last_exception}")

    async def ainvoke(self, prompt):
        last_exception = None
        for name, runnable in self._runnables:
            try:
                start_time = time.monotonic()
                result = await runnable.ainvoke(prompt)
                logger.info(f"[LocalEnsemble:structured] '{name}' responded in {time.monotonic() - start_time:.2f}s")
                return result
            except Exception as exc:
                logger.warning(f"[LocalEnsemble:structured] '{name}' failed ({exc}). Trying next...")
                last_exception = exc
                
        raise RuntimeError(f"All models failed for structured output ({self._schema.__name__}): {last_exception}")


class LocalFallbackEnsemble:

    def __init__(self, models):
        self._models = models

    def with_structured_output(self, schema):
        return StructuredFallbackWrapper(self._models, schema)

    def invoke(self, prompt):
        last_exception = None
        for name, model in self._models:
            try:
                start_time = time.monotonic()
                result = model.invoke(prompt)
                logger.info(f"[LocalEnsemble] '{name}' responded in {time.monotonic() - start_time:.2f}s")
                return result
            except Exception as exc:
                logger.warning(f"[LocalEnsemble] '{name}' failed ({exc}). Trying next...")
                last_exception = exc
                
        raise RuntimeError(f"All models failed: {last_exception}")

    async def ainvoke(self, prompt):
        last_exception = None
        for name, model in self._models:
            try:
                start_time = time.monotonic()
                result = await model.ainvoke(prompt)
                logger.info(f"[LocalEnsemble] '{name}' responded in {time.monotonic() - start_time:.2f}s")
                return result
            except Exception as exc:
                logger.warning(f"[LocalEnsemble] '{name}' failed ({exc}). Trying next...")
                last_exception = exc
                
        raise RuntimeError(f"All models failed: {last_exception}")



model_name = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:3b-base-q5_1")
timeout_seconds = int(os.getenv("OLLAMA_TIMEOUT", "300"))
ports_string = os.getenv("LOCAL_MODEL_PORTS", "11434")

port_list = [p.strip() for p in ports_string.split(",") if p.strip()]

logger.info(f"Setting up standalone local fallback ensemble across ports: {port_list}")

# Build our list of models
local_models = []
for port in port_list:
    model_instance = ChatOllama(
        model=model_name,
        base_url=f"http://localhost:{port}",
        temperature=0.7,
        top_p=0.95,
        num_predict=16384,
        timeout=timeout_seconds,
    )
    local_models.append((f"local_{port}", model_instance))

# Create the main ensemble object we'll use across the app
production_llm = LocalFallbackEnsemble(models=local_models)
