from llm_services.llm_mistral_service import MistralService

class MistralServiceBuilder:
    
    def __init__(self, model):
        self._instance = None
        self._model = model
    
    def __call__(self, mistral_api_key, **_ignored):
        if not self._instance:
            self._instance = MistralService(mistral_api_key, self._model)
        return self._instance