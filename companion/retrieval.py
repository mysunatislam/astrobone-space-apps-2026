from __future__ import annotations

import hashlib
import json
import re
import threading
from pathlib import Path
import numpy as np


class KnowledgeLibrary:
    def __init__(self, model, directory: Path):
        raw = Path(__file__).with_name('knowledge.json').read_bytes()
        self.manifest = json.loads(raw)
        self.chunks = self.manifest['chunks']
        self.digest = hashlib.sha256(raw).hexdigest()
        self.model = model
        self.directory = directory
        self.index = None
        self.lock = threading.Lock()

    def build_index(self):
        import faiss
        with self.lock:
            if self.index is not None:
                return
            self.directory.mkdir(parents=True, exist_ok=True)
            index_path = self.directory / 'evidence.faiss'
            metadata_path = self.directory / 'evidence.json'
            identity = {'corpus_sha256': self.digest, 'embedding_model': self.model.embedding_model, 'ids': [c['id'] for c in self.chunks]}
            if index_path.exists() and metadata_path.exists() and json.loads(metadata_path.read_text()) == identity:
                self.index = faiss.read_index(str(index_path))
                if self.index.ntotal == len(self.chunks):
                    return
            vectors = np.asarray(self.model.embed([c['title'] + '. ' + c['text'] for c in self.chunks]), dtype='float32')
            if vectors.ndim != 2 or len(vectors) != len(self.chunks) or not np.isfinite(vectors).all():
                raise ValueError('Invalid local embedding output')
            faiss.normalize_L2(vectors)
            index = faiss.IndexFlatIP(vectors.shape[1])
            index.add(vectors)
            faiss.write_index(index, str(index_path))
            metadata_path.write_text(json.dumps(identity), encoding='utf-8')
            self.index = index

    def search(self, query, *, use_embeddings=True, limit=3):
        mode = 'lexical-local'
        warning = None
        ranking = []
        if use_embeddings:
            try:
                import faiss
                self.build_index()
                vector = np.asarray(self.model.embed([query]), dtype='float32')
                if vector.ndim != 2 or vector.shape[1] != self.index.d or not np.isfinite(vector).all():
                    raise ValueError('Invalid query vector')
                faiss.normalize_L2(vector)
                scores, ids = self.index.search(vector, min(limit, len(self.chunks)))
                ranking = [(int(i), float(score)) for i, score in zip(ids[0], scores[0]) if i >= 0 and score > .15]
                mode = 'faiss-local-embedding'
            except Exception:
                warning = 'Local embeddings unavailable; lexical retrieval used, without cloud access.'
        if mode == 'lexical-local':
            tokens = set(re.findall(r'[a-z]{3,}', query.lower()))
            for i, chunk in enumerate(self.chunks):
                terms = set(re.findall(r'[a-z]{3,}', (' '.join(chunk['tags']) + ' ' + chunk['text']).lower()))
                score = len(tokens & terms) / max(1, len(tokens))
                if score:
                    ranking.append((i, score))
            ranking.sort(key=lambda item: (-item[1], self.chunks[item[0]]['id']))
        return {'mode': mode, 'corpus_sha256': self.digest, 'warning': warning,
                'sources': [{**self.chunks[i], 'retrieval_score': round(score, 4)} for i, score in ranking[:limit]]}
