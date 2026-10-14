"""Durable local/object-storage abstraction for uploaded committee reports.

The default is a configurable persistent directory. Production deployments should
point REPORT_STORAGE_DIR at a persistent volume or replace this adapter with S3.
"""
from hashlib import sha256
from pathlib import Path
import os
import re

STORAGE_DIR = Path(os.getenv("REPORT_STORAGE_DIR", "./var/report-storage"))


def persist_report(content: bytes, original_name: str) -> dict:
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", Path(original_name or "report.pdf").name)
    digest = sha256(content).hexdigest()
    ref = f"{digest[:16]}_{safe}"
    path = STORAGE_DIR / ref
    if not path.exists():
        path.write_bytes(content)
    return {
        "storage_ref": str(path),
        "sha256": digest,
        "size_bytes": len(content),
        "mime_type": "application/pdf",
    }
