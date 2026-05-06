from llm_services import llm_factory
from llm_services.llm_service import LLMService
import os
from dotenv import load_dotenv

load_dotenv()
CONFIG = {
    'anthropic_api_key': os.getenv("API_KEY_ANTHROPIC"),
    'mistral_api_key': os.getenv("API_KEY_MISTRAL"),
}

class LLMInitializer:
    
    def initialize_llm_service(model, temperature=1, tokens=1000, jwt=None):
        print('JWT initialised ', jwt)
        llmservice: LLMService = llm_factory.factory.create(model, **CONFIG)
        llmservice.temperature = temperature
        llmservice.tokens = tokens
        llmservice.jwt = jwt
        print(llmservice.jwt)
        return llmservice