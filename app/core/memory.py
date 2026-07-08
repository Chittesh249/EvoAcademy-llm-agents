import os
import logging
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)


class FallbackMemory:
    def __init__(self):
        self.store = {}
        logger.info("Initializing Fallback In-Memory Storage")

    def add(self, text: str, user_id: str, metadata: dict = None):
        if user_id not in self.store:
            self.store[user_id] = []
        self.store[user_id].append({"text": text, "metadata": metadata})
        logger.info(f"[Memory] Added: {text}")
        return {"status": "success"}

    def get_all(self, user_id: str):
        return self.store.get(user_id, [])


try:
    from mem0 import Memory
except Exception as e:
    Memory = None
    logger.warning(f"Mem0 import unavailable; using in-memory store: {e}")


def _build_mem0_client():
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPENROUTER_API_KEY")
    if not api_key or Memory is None:
        return FallbackMemory()

    try:
        config = {
            "vector_store": {
                "provider": "chroma",
                "config": {"path": "./.mem0_chromadb"},
            }
        }
        client = Memory.from_config(config)
        logger.info("Initialized Mem0 vector database")
        return client
    except Exception as e:
        logger.warning(f"Mem0 init failure, using in-memory store: {e}")
        return FallbackMemory()


mem0_client = _build_mem0_client()
