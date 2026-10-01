"""Structured JSON logging with secret scrubbing."""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone

from .scrub import scrub


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "event": getattr(record, "event", record.getMessage()),
            "request_id": getattr(record, "request_id", None),
        }
        for key in ("provider", "model", "job_id", "extra"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        return json.dumps(scrub(payload), ensure_ascii=False)


def configure_logging() -> logging.Logger:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger("studiofactory")
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    root.propagate = False
    return root


logger = logging.getLogger("studiofactory")
