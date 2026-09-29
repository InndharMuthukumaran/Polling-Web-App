"""Security and token utilities for the identity layer."""

import hashlib
import hmac
import secrets


def generate_token() -> str:
    """Generate a high-entropy secret token (admin or member token)."""
    return secrets.token_urlsafe(32)


def generate_join_code() -> str:
    """Generate an unguessable group join code."""
    return secrets.token_urlsafe(9)


def hash_token(token: str) -> str:
    """Compute the SHA-256 hex digest of a token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_token_hash(token: str, expected_hash: str) -> bool:
    """Verify a plain token against an expected SHA-256 hash in constant time."""
    if not token or not expected_hash:
        return False
    computed_hash = hash_token(token)
    return hmac.compare_digest(computed_hash, expected_hash)
