"""Utilities for high-entropy, one-time offline account-recovery codes."""
import hashlib
import secrets

CODE_COUNT = 10
CODE_HEX_LENGTH = 32  # 128 bits of entropy per code


def generate_recovery_codes(count: int = CODE_COUNT) -> list[str]:
    if count < 1 or count > 20:
        raise ValueError("Recovery-code count must be between 1 and 20")
    return [secrets.token_hex(CODE_HEX_LENGTH // 2) for _ in range(count)]


def digest_recovery_code(code: str) -> str:
    return hashlib.sha256(code.encode("ascii")).hexdigest()
