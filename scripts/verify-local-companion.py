"""Run a synthetic, actual-model smoke test against the loopback service."""
import json
import time
from pathlib import Path

import httpx


def main():
    base = 'http://127.0.0.1:8010/api/companion'
    with httpx.Client(base_url=base, trust_env=False, timeout=15) as client:
        health = client.get('/health').raise_for_status().json()
        assert health['llm']['available'], 'Local Llama/Gemma is not installed or running'
        assert health['llm']['embedding_available'], 'Local embeddinggemma is missing'
        crew = client.post('/demo', json={}).raise_for_status().json()
        run = client.post('/runs', json={'astronaut_id': crew['astronaut_id'], 'use_llm': True}).raise_for_status().json()
        deadline = time.monotonic() + 420
        while time.monotonic() < deadline:
            state = client.get('/runs/' + run['id']).raise_for_status().json()
            if state['status'] != 'running':
                break
            time.sleep(2)
        assert state['status'] == 'complete', state.get('error', 'Review timed out')
        report = state['report']
        assert report['engine'] == 'local-llm', report['warnings']
        assert report['retrieval']['mode'] == 'faiss-local-embedding'
        assert report['is_demo'] and not report['privacy']['cloud_used']
        assert report['evidence'] and report['model_digest']
        assert report['verification']['physics']['status'] == 'not_established'
        knee = next(row for row in report['comparison']['changes'] if row['metric'] == 'knee_extension_deg')
        assert knee['delta'] == -20 and knee['percent_change'] == -12.12
        path = Path(__file__).resolve().parents[1] / '.artifacts/companion/verified-local-llama-demo.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps({'result': 'passed', 'synthetic': True, 'model': report['model'],
                          'engine': report['engine'], 'retrieval': report['retrieval']['mode'],
                          'elapsed_ms': report['trace'][-1]['elapsed_ms'],
                          'profile': crew['astronaut_id'], 'report_file': str(path)}, indent=2))


if __name__ == '__main__':
    main()
