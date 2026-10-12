FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PYTHONPATH=/app/src PIP_NO_CACHE_DIR=1 MODEL_DIR=/app/models/minilm
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

# Sentence-embedding model (all-MiniLM-L6-v2, ONNX, ~90 MB) for meaning-based matching.
# If the download fails the app still runs, falling back to keyword matching.
COPY scripts/fetch_model.py scripts/fetch_model.py
RUN python scripts/fetch_model.py || echo "semantic model not downloaded: keyword matching only"

COPY src ./src
COPY frontend ./frontend
COPY samples ./samples
COPY eval ./eval
# Score the labelled set once at build time for the Model quality page.
RUN python -c "from resume_ai import evaluation; evaluation.write_card()"
EXPOSE 8000
# Hosts such as Render inject $PORT; locally it falls back to 8000.
CMD ["sh", "-c", "uvicorn resume_ai.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
