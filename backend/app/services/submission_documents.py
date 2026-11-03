"""Memoranda that citizens upload as documents instead of (or as well as) typing.

Accepted formats match what committee clerks receive in practice: PDF, Word
(.docx) and plain text. The file is kept in durable storage, and its text is
extracted so it can be read on the bill page and matched against the
committee report like a typed submission.
"""
from __future__ import annotations

import io
import re
import subprocess
import tempfile
import zipfile
from hashlib import sha256
from pathlib import Path
from xml.etree import ElementTree

from app.services.storage_service import STORAGE_DIR

MAX_BYTES = 10 * 1024 * 1024
ALLOWED = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
}
SUBMISSION_DIR = STORAGE_DIR / "submissions"
MAX_EXTRACTED_CHARS = 50_000


class DocumentRejected(ValueError):
    """The upload is not an accepted memorandum document."""


def _validate(content: bytes, filename: str) -> str:
    extension = Path(filename or "").suffix.lower()
    if extension not in ALLOWED:
        raise DocumentRejected("Upload your memorandum as a PDF, Word (.docx) or plain-text (.txt) file.")
    if not content:
        raise DocumentRejected("The uploaded document is empty.")
    if len(content) > MAX_BYTES:
        raise DocumentRejected("The uploaded document is larger than 10 MB.")
    if extension == ".pdf" and not content.startswith(b"%PDF"):
        raise DocumentRejected("The uploaded file is not a valid PDF.")
    if extension == ".docx" and not zipfile.is_zipfile(io.BytesIO(content)):
        raise DocumentRejected("The uploaded file is not a valid Word document.")
    return extension


def _pdf_text(content: bytes) -> str:
    with tempfile.TemporaryDirectory(prefix="memo-") as directory:
        source = Path(directory) / "memo.pdf"
        source.write_bytes(content)
        try:
            result = subprocess.run(
                ["pdftotext", "-layout", str(source), "-"],
                check=True, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60,
            )
        except (OSError, subprocess.SubprocessError):
            return ""
        return result.stdout


def _docx_text(content: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            # Guard against compressed "zip bombs" before decompressing.
            if archive.getinfo("word/document.xml").file_size > 40 * 1024 * 1024:
                raise DocumentRejected("The Word document is too large to read.")
            xml = archive.read("word/document.xml")
    except (KeyError, zipfile.BadZipFile):
        raise DocumentRejected("The uploaded file is not a valid Word document.")
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    root = ElementTree.fromstring(xml)
    paragraphs = []
    for paragraph in root.iter(f"{namespace}p"):
        paragraphs.append("".join(node.text or "" for node in paragraph.iter(f"{namespace}t")))
    return "\n".join(paragraphs)


def extract_text(content: bytes, extension: str) -> str:
    if extension == ".pdf":
        raw = _pdf_text(content)
    elif extension == ".docx":
        raw = _docx_text(content)
    else:
        raw = content.decode("utf-8", errors="replace")
    # Collapse layout whitespace but keep paragraph breaks readable.
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in raw.replace("\r", "").split("\n")]
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return text[:MAX_EXTRACTED_CHARS]


def store(content: bytes, filename: str) -> dict:
    """Validate and persist an uploaded memorandum, returning its metadata and text."""
    extension = _validate(content, filename)
    digest = sha256(content).hexdigest()
    safe_name = re.sub(r"[^A-Za-z0-9_.-]", "_", Path(filename).name)[:120] or f"memorandum{extension}"
    SUBMISSION_DIR.mkdir(parents=True, exist_ok=True)
    path = SUBMISSION_DIR / f"{digest[:16]}_{safe_name}"
    if not path.exists():
        path.write_bytes(content)
    return {
        "name": Path(filename).name[:255],
        "mime_type": ALLOWED[extension],
        "size_bytes": len(content),
        "sha256": digest,
        "storage_ref": path.name,
        "text": extract_text(content, extension),
    }


def path_for(storage_ref: str) -> Path | None:
    """Resolve a stored reference without allowing paths outside the folder."""
    name = Path(storage_ref or "").name
    path = SUBMISSION_DIR / name
    return path if name and path.is_file() else None
