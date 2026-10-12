"""Meaning-based matching with a small sentence-embedding model.

The model is all-MiniLM-L6-v2 exported to ONNX (about 90 MB), run with
onnxruntime and a Hugging Face tokenizer: no PyTorch, so it fits a 512 MB
server. Sentences are mean-pooled and L2-normalised, so a dot product is the
cosine similarity.

Everything here is optional. If the model files are missing (MODEL_DIR unset,
download failed), `available()` is False and the engine falls back to TF-IDF
and the regex phrase list, with the same outputs minus the semantic part.
"""
from __future__ import annotations

import hashlib
import os
import re
import threading
from collections import OrderedDict
from pathlib import Path

import numpy as np

DEFAULT_DIR = Path(__file__).resolve().parents[2] / "models" / "minilm"
MAX_TOKENS = 128
BATCH = 64

_lock = threading.Lock()
_state: dict = {"loaded": False, "session": None, "tokenizer": None, "error": None}
_cache: OrderedDict[str, np.ndarray] = OrderedDict()
_CACHE_MAX = 4000


def model_dir() -> Path:
    return Path(os.environ.get("MODEL_DIR", DEFAULT_DIR))


def _load() -> None:
    """Load the model once. Callers arriving while it loads wait for it, so
    every request sees the same answer (never a half-loaded "not available")."""
    if _state["loaded"]:
        return
    with _lock:
        if _state["loaded"]:
            return
        session = tokenizer = error = None
        if os.environ.get("SEMANTIC", "on").lower() in ("off", "0", "false"):
            error = "turned off with SEMANTIC=off"
        else:
            d = model_dir()
            try:
                import onnxruntime as ort
                from tokenizers import Tokenizer

                opts = ort.SessionOptions()
                opts.intra_op_num_threads = int(os.environ.get("SEMANTIC_THREADS", "1"))
                opts.inter_op_num_threads = 1
                session = ort.InferenceSession(str(d / "model.onnx"), opts, providers=["CPUExecutionProvider"])
                tokenizer = Tokenizer.from_file(str(d / "tokenizer.json"))
                tokenizer.enable_truncation(MAX_TOKENS)
                tokenizer.enable_padding(pad_id=0, pad_token="[PAD]")
            except Exception as e:  # missing files, missing packages, corrupt model
                session, tokenizer, error = None, None, f"{type(e).__name__}: {e}"
        _state.update(session=session, tokenizer=tokenizer, error=error)
        _state["loaded"] = True          # last: only now may callers skip the lock


def available() -> bool:
    _load()
    return _state["session"] is not None


def status() -> dict:
    _load()
    return {"available": _state["session"] is not None, "model": "all-MiniLM-L6-v2 (ONNX)",
            "reason": _state["error"]}


def _key(text: str) -> str:
    return hashlib.blake2b(text.encode("utf-8"), digest_size=12).hexdigest()


def embed(texts: list[str]) -> np.ndarray:
    """Unit-length embeddings, shape (len(texts), 384). Cached by text."""
    if not available():
        raise RuntimeError("semantic model not available")
    out: list[np.ndarray | None] = [None] * len(texts)
    todo = []
    for i, t in enumerate(texts):
        k = _key(t)
        if k in _cache:
            _cache.move_to_end(k)
            out[i] = _cache[k]
        else:
            todo.append(i)
    sess, tok = _state["session"], _state["tokenizer"]
    names = {i.name for i in sess.get_inputs()}
    todo.sort(key=lambda i: len(texts[i]))      # similar lengths together: less padding per batch
    for s in range(0, len(todo), BATCH):
        idx = todo[s:s + BATCH]
        enc = tok.encode_batch([texts[i] for i in idx])
        ids = np.array([e.ids for e in enc], dtype=np.int64)
        mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
        feed = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in names:
            feed["token_type_ids"] = np.zeros_like(ids)
        hidden = sess.run(None, feed)[0]                      # (batch, tokens, 384)
        m = mask[..., None].astype(np.float32)
        vec = (hidden * m).sum(1) / np.clip(m.sum(1), 1e-9, None)
        vec /= np.clip(np.linalg.norm(vec, axis=1, keepdims=True), 1e-9, None)
        with _lock:
            for j, i in enumerate(idx):
                out[i] = vec[j]
                _cache[_key(texts[i])] = vec[j]
            while len(_cache) > _CACHE_MAX:
                _cache.popitem(last=False)
    return np.vstack(out) if out else np.zeros((0, 384), dtype=np.float32)


# ------------------------------------------------------------------ text units
_SPLIT = re.compile(r"(?<=[.;!?])\s+|\n+")


from .parsing import RANGE_RE as _ROLE_HEADER, SINCE_RE as _SINCE  # noqa: E402  (role headers carry dates)


def units(text: str, min_words: int = 4, limit: int = 40) -> list[str]:
    """Sentences and bullet lines long enough to carry meaning.

    Role headers ("Data Scientist — Acme | Jun 2020 – Present") are left out:
    a job title with dates says nothing about the work itself.
    """
    seen, out = set(), []
    for part in _SPLIT.split(text):
        p = re.sub(r"^\s*(?:[-•*▪●◦‣·]|\d+[.)])\s+", "", part).strip()
        if (_ROLE_HEADER.search(p) or _SINCE.search(p)) and len(p.split()) <= 12:
            continue
        if len(p.split()) >= min_words and p.lower() not in seen:
            seen.add(p.lower())
            out.append(p[:400])
        if len(out) >= limit:
            break
    return out


def coverage(job_lines: list[str], resume_lines: list[str]) -> tuple[float, list[dict]]:
    """How well the resume covers each job line, by meaning.

    For every job line, the closest resume line and its similarity. The score
    is the mean of those best similarities.
    """
    if not job_lines or not resume_lines:
        return 0.0, []
    sims = embed(job_lines) @ embed(resume_lines).T
    best = sims.argmax(1)
    pairs = [{"job": job_lines[i], "resume": resume_lines[best[i]], "sim": float(sims[i, best[i]])}
             for i in range(len(job_lines))]
    return float(np.mean([p["sim"] for p in pairs])), pairs


def best_evidence(queries: dict[str, str | list[str]], resume_lines: list[str]) -> dict[str, tuple[str, float]]:
    """For each {key: query text or list of phrasings}, the closest resume line
    and its similarity (the best over all phrasings)."""
    if not queries or not resume_lines:
        return {}
    keys = list(queries)
    flat, owner = [], []
    for i, k in enumerate(keys):
        qs = queries[k] if isinstance(queries[k], list) else [queries[k]]
        flat += qs
        owner += [i] * len(qs)
    sims = embed(flat) @ embed(resume_lines).T                 # (phrasings, lines)
    owner = np.array(owner)
    out = {}
    for i, k in enumerate(keys):
        block = sims[owner == i]
        q, j = np.unravel_index(int(block.argmax()), block.shape)
        out[k] = (resume_lines[j], float(block[q, j]))
    return out
