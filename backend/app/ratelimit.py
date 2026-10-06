"""In-memory rate limiter with sliding window, bounded memory, and client IP resolution."""

import time
from typing import Callable

from fastapi import Request

from app.config import settings
from app.errors import RateLimitError


def get_client_ip(request: Request, trusted_proxy_count: int | None = None) -> str:
    """Extract client IP based on trusted proxy count.

    - When trusted_proxy_count is 0, ignores X-Forwarded-For completely and uses request.client.host.
    - When trusted_proxy_count is N > 0, uses the entry that is N positions from the right
      in X-Forwarded-For (the address added by your own N-th proxy).
    - If the header has fewer than N entries or is missing, falls back to request.client.host.
    """
    if trusted_proxy_count is None:
        trusted_proxy_count = settings.trusted_proxy_count

    fallback = request.client.host if (request.client and request.client.host) else "127.0.0.1"

    if trusted_proxy_count <= 0:
        return fallback

    forwarded = request.headers.get("x-forwarded-for")
    if not forwarded:
        return fallback

    entries = [part.strip() for part in forwarded.split(",") if part.strip()]
    if len(entries) < trusted_proxy_count:
        return fallback

    return entries[-trusted_proxy_count]


class RateLimiter:
    """Sliding-window rate limiter with bounded memory and injectable clock."""

    def __init__(
        self,
        default_limit: int = 30,
        window_seconds: float = 60.0,
        clock: Callable[[], float] = time.time,
        max_keys: int = 10000,
        cleanup_interval: float = 60.0,
    ) -> None:
        self.default_limit = default_limit
        self.window_seconds = window_seconds
        self.clock = clock
        self.max_keys = max_keys
        self.cleanup_interval = cleanup_interval
        self.last_cleanup_time = 0.0
        self._entries: dict[str, list[float]] = {}

    def set_clock(self, clock: Callable[[], float]) -> None:
        """Inject a custom clock (used by tests to simulate time advancing)."""
        self.clock = clock

    def reset(self) -> None:
        """Clear all rate limit records and reset cleanup timer."""
        self._entries.clear()
        self.last_cleanup_time = 0.0

    def _maybe_cleanup(self, now: float) -> None:
        """Run a cleanup pass over all keys at most once every cleanup_interval seconds."""
        if now - self.last_cleanup_time >= self.cleanup_interval:
            cutoff = now - self.window_seconds
            keys_to_remove = []
            for k, timestamps in list(self._entries.items()):
                active = [t for t in timestamps if t > cutoff]
                if not active:
                    keys_to_remove.append(k)
                else:
                    self._entries[k] = active
            for k in keys_to_remove:
                self._entries.pop(k, None)
            self.last_cleanup_time = now

    def check(self, key: str, limit: int | None = None) -> None:
        """Check if key has exceeded its limit without recording an attempt.

        Deletes key if all its timestamps have expired.
        Raises RateLimitError if active attempts >= limit.
        """
        now = self.clock()
        self._maybe_cleanup(now)
        cutoff = now - self.window_seconds

        timestamps = self._entries.get(key)
        if timestamps is not None:
            active = [t for t in timestamps if t > cutoff]
            if not active:
                self._entries.pop(key, None)
                return
            self._entries[key] = active
            effective_limit = limit if limit is not None else self.default_limit
            if len(active) >= effective_limit:
                raise RateLimitError("Too many attempts. Please wait a minute and try again.")

    def record(self, key: str) -> None:
        """Record a failure timestamp for key, respecting the total key cap."""
        now = self.clock()
        self._maybe_cleanup(now)
        cutoff = now - self.window_seconds

        timestamps = self._entries.get(key)
        if timestamps is not None:
            active = [t for t in timestamps if t > cutoff]
            active.append(now)
            self._entries[key] = active
        else:
            # New key: enforce capacity cap
            if len(self._entries) >= self.max_keys:
                # Evict key with the oldest latest timestamp
                oldest_key = min(
                    self._entries.keys(),
                    key=lambda k: self._entries[k][-1] if self._entries[k] else float("-inf"),
                )
                self._entries.pop(oldest_key, None)
            self._entries[key] = [now]

    def check_and_record(self, key: str, limit: int | None = None) -> None:
        """Convenience method to check limit and record attempt in one step."""
        self.check(key, limit=limit)
        self.record(key)


# Global rate limiter instance for member identifier lookups
lookup_limiter = RateLimiter(default_limit=30, window_seconds=60.0, max_keys=10000)
