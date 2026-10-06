"""In-memory rate limiter with sliding window and injectable clock."""

from collections import defaultdict
import time
from typing import Callable

from app.errors import RateLimitError


class RateLimiter:
    """Sliding-window rate limiter for tracking attempts by key."""

    def __init__(
        self,
        max_requests: int = 10,
        window_seconds: float = 60.0,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.clock = clock
        self._entries: dict[str, list[float]] = defaultdict(list)

    def set_clock(self, clock: Callable[[], float]) -> None:
        """Inject a custom clock (used by tests to simulate time advancing)."""
        self.clock = clock

    def reset(self) -> None:
        """Clear all rate limit records."""
        self._entries.clear()

    def check(self, key: str) -> None:
        """Record an attempt for the key or raise RateLimitError if exceeded."""
        now = self.clock()
        cutoff = now - self.window_seconds
        timestamps = [t for t in self._entries[key] if t > cutoff]
        if len(timestamps) >= self.max_requests:
            self._entries[key] = timestamps
            raise RateLimitError("Too many attempts. Please wait a minute and try again.")
        timestamps.append(now)
        self._entries[key] = timestamps


# Global rate limiter instance for the lookup endpoint
lookup_limiter = RateLimiter(max_requests=10, window_seconds=60.0)
