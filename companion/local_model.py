from __future__ import annotations

import json
import os
from urllib.parse import urlparse
import httpx


class ModelUnavailable(RuntimeError):
    pass


class LocalModel:
    def __init__(self):
        self.base = os.getenv('ASTROBONE_OLLAMA_URL', 'http://127.0.0.1:11434').rstrip('/')
        url = urlparse(self.base)
        if url.scheme != 'http' or url.hostname not in {'127.0.0.1', 'localhost', '::1'} or url.username or url.password or url.path or url.query or url.fragment:
            raise ValueError('Only a loopback Ollama endpoint is allowed in local-only mode')
        self.model = os.getenv('ASTROBONE_LOCAL_MODEL', 'llama3.2:3b')
        if self.model not in {'llama3.2:3b', 'llama3.2:1b', 'gemma3:4b', 'gemma3:1b'}:
            raise ValueError('Select a supported local Llama/Gemma model, not a cloud model')
        self.embedding_model = 'embeddinggemma'
        self.timeout = float(os.getenv('ASTROBONE_MODEL_TIMEOUT_SECONDS', '90'))

    def _request(self, method, path, payload=None, timeout=None):
        try:
            with httpx.Client(timeout=timeout or self.timeout, trust_env=False) as client:
                result = client.request(method, self.base + path, json=payload)
                result.raise_for_status()
                return result.json()
        except (httpx.HTTPError, ValueError) as error:
            raise ModelUnavailable('Local model unavailable or timed out; no cloud fallback was used') from error

    def status(self):
        try:
            data = self._request('GET', '/api/tags', timeout=2)
            local = [m for m in data.get('models', []) if not m.get('remote_host') and not m.get('remote_model') and ':cloud' not in m.get('name', '')]
            selected = next((m for m in local if m.get('name') == self.model), None)
            embedding = any(m.get('name', '').split(':')[0] == self.embedding_model for m in local)
            return {'available': bool(selected), 'model': self.model, 'digest': selected.get('digest') if selected else None,
                    'embedding_available': embedding, 'models': [m['name'] for m in local], 'local_only': True}
        except ModelUnavailable:
            return {'available': False, 'model': self.model, 'digest': None, 'embedding_available': False, 'models': [], 'local_only': True}

    def structured(self, system, payload, response_type):
        schema = response_type.model_json_schema()
        data = self._request('POST', '/api/chat', {
            'model': self.model, 'stream': False, 'format': schema, 'keep_alive': '2m',
            'options': {'temperature': 0, 'num_ctx': 4096, 'num_predict': 400},
            'messages': [
                {'role': 'system', 'content': system + '\nReturn only JSON matching this schema: ' + json.dumps(schema)},
                {'role': 'user', 'content': json.dumps(payload)},
            ],
        })
        if not data.get('done'):
            raise ModelUnavailable('Local model did not finish its response')
        return response_type.model_validate_json(data['message']['content'])

    def embed(self, texts):
        data = self._request('POST', '/api/embed', {'model': self.embedding_model, 'input': texts, 'truncate': False, 'keep_alive': 0})
        return data['embeddings']
