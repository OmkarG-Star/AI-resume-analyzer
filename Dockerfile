FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PYTHONPATH=/app/src PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY src ./src
COPY frontend ./frontend
COPY samples ./samples
EXPOSE 8000
# Hosts such as Render inject $PORT; locally it falls back to 8000.
CMD ["sh", "-c", "uvicorn resume_ai.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
