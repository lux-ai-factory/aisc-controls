from llm_services.llm_service import LLMService
from anthropic import Anthropic
import time
import httpx
class AnthropicService(LLMService):
    
    def __init__(self, anthropic_api_key, model):
        self.model = model
        self.client = Anthropic(api_key=anthropic_api_key, http_client=httpx.Client(verify=False))  # disable SSL verification
        self.provider = 'Anthropic'

    def execute_prompt(self, prompt):
        time.sleep(1)
        response = self.client.messages.create(
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            model=self.model,
        )

        return response.content[0].text
