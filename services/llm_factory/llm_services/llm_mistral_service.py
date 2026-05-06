from llm_services.llm_service import LLMService
from mistralai import Mistral
import httpx


class MistralService(LLMService):

    def __init__(self, mistral_api_key, model):
        self.model = model
        self.client = Mistral(api_key=mistral_api_key, client=httpx.Client(verify=False)) # disable SSL verification
        self.provider = 'Mistral'

    def execute_prompt(self, prompt):
        response = self.client.chat.complete(
        model = self.model,
        messages = [
            {
                "role": "user",
                "content": prompt,
            },
        ], 
        )
        return response.choices[0].message.content