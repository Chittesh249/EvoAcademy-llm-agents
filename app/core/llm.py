import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()

# Architect model for task planning and tutoring
architect_llm = ChatOpenAI(
    model="nvidia/nemotron-3-ultra-550b-a55b",
    api_key=os.getenv("OPENROUTER_API_KEY"),
    base_url="https://integrate.api.nvidia.com/v1",
)

# Coder model for parallel code block writing
coder_llm = ChatOpenAI(
    model="nvidia/nemotron-3-ultra-550b-a55b",
    api_key=os.getenv("OPENROUTER_API_KEY"),
    base_url="https://integrate.api.nvidia.com/v1",
)
