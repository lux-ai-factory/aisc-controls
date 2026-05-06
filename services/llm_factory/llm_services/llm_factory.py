from llm_services.llm_abstract_factory import LLMFactory
from llm_services.llm_plugins_factory import PluginsImporter
from llm_services.llm_anthropic_factory import AnthropicServiceBuilder
from llm_services.llm_mistral_factory import MistralServiceBuilder

factory = LLMFactory()

plugins_importer = PluginsImporter()
plugins = plugins_importer.import_all_plugins()

# Register all plugins
for plugin_name, builder in plugins.items():
    if hasattr(builder, 'name'):
        factory.register_builder(builder.name(), builder)

# Anthropic — keys are the Anthropic API model IDs so callers can pass them
# straight through from LLM_MODEL.
factory.register_builder('claude-opus-4-7', AnthropicServiceBuilder('claude-opus-4-7'))
factory.register_builder('claude-sonnet-4-6', AnthropicServiceBuilder('claude-sonnet-4-6'))
factory.register_builder('claude-haiku-4-5', AnthropicServiceBuilder('claude-haiku-4-5-20251001'))

# Mistral — same convention: keys are Mistral API model IDs.
factory.register_builder('mistral-large-latest', MistralServiceBuilder('mistral-large-latest'))
factory.register_builder('mistral-medium-latest', MistralServiceBuilder('mistral-medium-latest'))
factory.register_builder('ministral-8b-latest', MistralServiceBuilder('ministral-8b-latest'))
factory.register_builder('ministral-3b-latest', MistralServiceBuilder('ministral-3b-latest'))
