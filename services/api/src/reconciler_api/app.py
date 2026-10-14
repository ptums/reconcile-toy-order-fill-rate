"""Upload API (producer). Lesson 3 adds: store the CSV in S3, create the job, publish rows to NATS."""

from fastapi import FastAPI

app = FastAPI(title="Order reconciler API")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
