from flask import Flask, request, jsonify
from llm_initializer import LLMInitializer
from datetime import datetime
from asgiref.wsgi import WsgiToAsgi


app = Flask(__name__)

@app.route('/execute_prompt', methods=['POST'])
def execute_prompt():
    data = request.json or {}
    model = data.get('model', '')
    prompt = data.get('prompt', '')
    jwt = data.get('jwt', '')
    tokens = data.get('tokens', 1000)
    try:
        llmservice = LLMInitializer.initialize_llm_service(model, tokens=tokens, jwt=jwt)
        return jsonify({'response': llmservice.execute_prompt(prompt)})
    except ValueError as e:
        # factory.create raises ValueError(model) when LLM_MODEL isn't registered.
        return jsonify({
            'error': f'Unknown model "{e}". Register it in llm_services/llm_factory.py or pick a registered one.',
        }), 400
    except Exception as e:
        # Most commonly: provider auth failure (missing/wrong API key) or
        # upstream provider error. Surface the class + message so the Node
        # client can tell the user something useful instead of a stack trace.
        return jsonify({
            'error': f'{type(e).__name__}: {e}',
        }), 500
        

@app.route('/health', methods=['GET'])
def health_check():
    timestamp = datetime.now().isoformat()
    response = {
        "status": "OK",
        "message": "Service is running",
        "timestamp": timestamp
    }
    print(timestamp)
    return jsonify(response), 200

asgi_app = WsgiToAsgi(app)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
