"""
app/core/llm.py
---------------
LLM handles for all EvoAcademy agents.

Architecture
------------
All model access goes through ModelEnsemble instances defined at the bottom
of this file.  Each ensemble is cloud-first (ZhipuAI GLM-5.2 via NVIDIA NIM,
using the native ChatNVIDIA client) with Ollama local as the automatic fallback,
so the system stays operational even without internet access.

Raw model handles (_cloud_*, _local_*) are kept as private module-level
objects and are NOT imported directly by agent nodes.  Agent nodes should
import the ensemble handles (architect_llm, coder_llm, guardrail_llm) only.

Ensemble strategies per role
-----------------------------
architect_llm  (fallback) — Planning, analysis, tutoring, summaries.
                            Quality matters; cloud-first, local on failure.
coder_llm      (race)     — Parallel code cell generation.
                            Fire both cloud and local; return the winner.
                            Distributes load and minimises tail latency.
guardrail_llm  (vote)     — Prompt domain validation.
                            Both models vote; majority decides is_valid_ea.
                            Reduces false positives / negatives.

Environment variables
---------------------
NVIDIA_API_KEY    — NVIDIA NIM API key (required for cloud path)
NIM_MODEL         — NIM model ID (default: z-ai/glm-5.2)
CLOUD_TIMEOUT     — Cloud request timeout in seconds (default: 120)
OLLAMA_BASE_URL   — Ollama server URL (default: http://localhost:11434)
OLLAMA_MODEL      — Local model name (default: qwen2.5-coder:3b-base-q5_1)
OLLAMA_TIMEOUT    — Ollama request timeout in seconds (default: 300)
"""
import logging
import os

from dotenv import load_dotenv
from langchain_nvidia_ai_endpoints import ChatNVIDIA
from langchain_ollama import ChatOllama

from app.core.ensemble import ModelEnsemble

load_dotenv()
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration — all values are overridable via environment variables
# ---------------------------------------------------------------------------

# Cloud: ZhipuAI GLM-5.2 via NVIDIA NIM (native ChatNVIDIA client)
_NIM_API_KEY   = os.getenv("NVIDIA_API_KEY", "")
_NIM_MODEL     = os.getenv("NIM_MODEL", "z-ai/glm-5.2")
_CLOUD_TIMEOUT = int(os.getenv("CLOUD_TIMEOUT", "120"))

# Local (Ollama) settings
_OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
_OLLAMA_MODEL    = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:3b-base-q5_1")
_OLLAMA_TIMEOUT  = int(os.getenv("OLLAMA_TIMEOUT", "300"))

logger.info(
    "[LLM] Cloud model : %s @ NVIDIA NIM (timeout=%ds)",
    _NIM_MODEL, _CLOUD_TIMEOUT,
)
logger.info(
    "[LLM] Local model : %s @ %s (timeout=%ds)",
    _OLLAMA_MODEL, _OLLAMA_BASE_URL, _OLLAMA_TIMEOUT,
)

# ---------------------------------------------------------------------------
# Raw model handles (private — do not import directly from agent nodes)
# ---------------------------------------------------------------------------

_cloud_architect = ChatNVIDIA(
    model=_NIM_MODEL,
    api_key=_NIM_API_KEY or "placeholder",
    temperature=1,
    top_p=1,
    max_tokens=16384,
    seed=42,
    timeout=_CLOUD_TIMEOUT,
)

_cloud_coder = ChatNVIDIA(
    model=_NIM_MODEL,
    api_key=_NIM_API_KEY or "placeholder",
    temperature=0.2,
    top_p=1,
    max_tokens=16384,
    seed=42,
    timeout=_CLOUD_TIMEOUT,
)

# Local fallback — architect role
_local_architect = ChatOllama(
    model=_OLLAMA_MODEL,
    base_url=_OLLAMA_BASE_URL,
    temperature=0.7,
    top_p=0.95,
    num_predict=16384,
    timeout=_OLLAMA_TIMEOUT,
)

# Local fallback — coder role
_local_coder = ChatOllama(
    model=_OLLAMA_MODEL,
    base_url=_OLLAMA_BASE_URL,
    temperature=0.2,
    top_p=0.95,
    num_predict=8192,
    timeout=_OLLAMA_TIMEOUT,
)

# ---------------------------------------------------------------------------
# Ensemble handles (public — import these in agent nodes)
# ---------------------------------------------------------------------------

# Architect ensemble: fallback — cloud first, local on failure
# Used by: task_splitter, dependency_analyzer, modifier_agent,
#          learner_agent, _generate_summary
architect_llm = ModelEnsemble(
    models=[
        ("zai-glm52", _cloud_architect),
        ("ollama",    _local_coder),
    ],
    strategy="fallback",
    label="architect",
)

# Coder ensemble: race — fire cloud + local simultaneously, first wins.
# Distributes the load of 12 parallel cell-generation calls across both
# backends while cutting median latency.
# Used by: parallel_coder_node
coder_llm = ModelEnsemble(
    models=[
        ("zai-glm52", _cloud_coder),
        ("ollama",    _local_coder),
    ],
    strategy="race",
    label="coder",
)

# Guardrail ensemble: fallback
# Used by: prompt_guardrail_node
guardrail_llm = ModelEnsemble(
    models=[
        ("zai-glm52", _cloud_architect),
        ("ollama",    _local_coder),
    ],
    strategy="fallback",
    label="guardrail",
)
