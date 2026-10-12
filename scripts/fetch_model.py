"""Download the sentence-embedding model used for meaning-based matching.

all-MiniLM-L6-v2 exported to ONNX (~90 MB) plus its tokenizer, from Hugging
Face, into MODEL_DIR (default models/minilm). The Docker build runs this; run
it yourself for local development. Without these files the app falls back to
keyword matching.
"""
import os
import pathlib
import urllib.request

BASE = "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/"
FILES = (("onnx/model.onnx", "model.onnx"), ("tokenizer.json", "tokenizer.json"))

out = pathlib.Path(os.environ.get("MODEL_DIR", pathlib.Path(__file__).resolve().parents[1] / "models" / "minilm"))
out.mkdir(parents=True, exist_ok=True)
for remote, local in FILES:
    urllib.request.urlretrieve(BASE + remote, out / local)
    print(f"{local}: {(out / local).stat().st_size:,} bytes")
