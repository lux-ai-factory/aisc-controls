from llm_services.llm_anthropic_service import AnthropicService

class AnthropicServiceBuilder:
    
    def __init__(self, model):
        self._instance = None
        self._model = model
    
    def __call__(self, anthropic_api_key, **_ignored):
        if not self._instance:
            self._instance = AnthropicService(anthropic_api_key, self._model)
        return self._instance