FROM python:3.12-slim
WORKDIR /app
COPY config /app/config
COPY worker /app/worker
RUN pip install --no-cache-dir "/app/worker[postgres]"
WORKDIR /app/worker
USER nobody
CMD ["python", "-m", "airwatch", "run", "--store", "postgres", "--provider", "fake"]
