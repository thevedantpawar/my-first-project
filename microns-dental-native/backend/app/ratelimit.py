"""A small in-process rate limiter for public endpoints.

Scope, stated plainly: this is a per-worker sliding window held in memory. It
stops a bored visitor hammering the chat widget and running up an OpenAI bill.
It is **not** a defence against a distributed attack, and it does not
coordinate across replicas — put a real limiter (nginx, Cloudflare, an API
gateway, or a Redis-backed one using ``REDIS_URL``) in front of this service
before exposing it to the internet.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from typing import Deque

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
            # Opportunistic cleanup so an unbounded key space (every IP that
            # ever visited) cannot grow forever.
            if len(self._hits) > 10_000:
                for stale_key in [k for k, v in self._hits.items() if not v]:
                    del self._hits[stale_key]
            return True

    def check(self, request: Request, *, key: str | None = None) -> None:
        identifier = key or _client_key(request)
        if not self.allow(identifier):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please slow down.",
            )


def _client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


#: 30 chat turns per minute per IP — generous for a human, cheap to exceed for a bot.
chat_limiter = SlidingWindowLimiter(limit=30, window_seconds=60)
#: Qualification submissions are heavier (they can trigger a booking).
qualify_limiter = SlidingWindowLimiter(limit=10, window_seconds=60)
