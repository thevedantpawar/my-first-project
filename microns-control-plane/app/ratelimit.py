"""A small in-process rate limiter for unauthenticated endpoints.

Scope, stated plainly: a per-worker sliding window held in memory. It stops
someone walking a password list against one address from a single host. It does
**not** coordinate across replicas and is not a defence against a distributed
attack — put a real limiter (Cloudflare, an API gateway, or a Redis-backed one)
in front of this service before exposing it to the internet.

Login is limited on both the address and the caller's IP. Address alone lets
one host spray many accounts; IP alone lets a botnet grind one account.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Deque, Optional

from fastapi import HTTPException, Request, status


class SlidingWindowLimiter:
    def __init__(self, *, limit: int, window_seconds: int) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            # Opportunistic cleanup so an unbounded key space cannot grow
            # forever.
            if len(self._hits) > 10_000:
                for stale in [k for k, v in self._hits.items() if not v]:
                    del self._hits[stale]
            return True

    def check(self, request: Request, *, key: Optional[str] = None) -> None:
        if not self.allow(key or client_key(request)):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Please wait a minute and try again.",
            )

    def reset(self) -> None:
        """Clear all windows. Used by the tests."""
        with self._lock:
            self._hits.clear()


def client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


#: Ten attempts per address per five minutes. Generous for a person who has
#: forgotten which password they used, useless for a list.
login_limiter = SlidingWindowLimiter(limit=10, window_seconds=300)

#: Signup and reset are cheap to abuse and expensive to serve — reset sends
#: mail, signup runs Argon2.
signup_limiter = SlidingWindowLimiter(limit=5, window_seconds=900)
reset_limiter = SlidingWindowLimiter(limit=5, window_seconds=900)


__all__ = ["SlidingWindowLimiter", "login_limiter", "signup_limiter", "reset_limiter", "client_key"]
