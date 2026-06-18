FROM python:3.10-slim

WORKDIR /app

RUN pip install --no-cache-dir fastapi uvicorn sentence-transformers

COPY embed_server.py .

# Run as non-root user
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8001

CMD ["uvicorn", "embed_server:app", "--host", "0.0.0.0", "--port", "8001", "--no-access-log"]
