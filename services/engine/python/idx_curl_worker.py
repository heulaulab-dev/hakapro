"""JSON-lines worker used by the TypeScript engine; stdout is reserved for protocol responses."""

import asyncio
import json
import logging
import os
import sys

from idx_transport import IDXTransportClient


def emit(message):
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


async def run():
    logging.basicConfig(stream=sys.stderr, level=os.getenv("ENGINE_IDX_LOG_LEVEL", "INFO"), format="%(message)s")
    base_url = os.environ["ENGINE_IDX_PRIMARY_BASE_URL"]
    client = IDXTransportClient(
        base_url,
        max_retries=int(os.getenv("ENGINE_IDX_PRIMARY_MAX_RETRIES", "3")),
        timeout=float(os.getenv("ENGINE_IDX_PRIMARY_TIMEOUT_SECONDS", "30")),
        success_delay=float(os.getenv("ENGINE_IDX_PRIMARY_DELAY_SECONDS", "2")),
        impersonate=os.getenv("ENGINE_IDX_PRIMARY_IMPERSONATE", "chrome"),
    )
    async with client:
        while True:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:
                break
            message = None
            try:
                message = json.loads(line)
                request_id = message.get("id")
                if message.get("op") == "close":
                    emit({"id": request_id, "ok": True, "closed": True})
                    break
                if message.get("op") == "request":
                    result = await client.fetch_json(message["path"], message.get("params", {}))
                else:
                    result = await client.fetch_index_summary(message["date"])
                emit({"id": request_id, "result": result})
            except Exception as exc:
                emit({"id": message.get("id") if isinstance(message, dict) else None, "error": type(exc).__name__})


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except Exception as exc:
        logging.basicConfig(stream=sys.stderr, level=logging.ERROR, format="%(message)s")
        logging.error(json.dumps({"event": "idx_worker_fatal", "error": type(exc).__name__}))
        raise
