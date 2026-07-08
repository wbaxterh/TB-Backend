"""Pipeline abstraction + mock pipeline.

v0.1 Day 3: mock pipeline that simulates TTS on timers so we can prove
the wire protocol end-to-end without hitting a real TTS provider.

Queue semantics: each `handle_text` call enqueues an utterance. A worker
task drains the queue sequentially, running `_synthesize` to completion
for each entry. `barge_in` clears the queue AND cancels the current
synthesis — this matches the RuntimeAdapter contract where only
explicit barge-in interrupts.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Protocol
from uuid import uuid4

from .envelope import (
    BargeInDetectedEvent,
    ErrorEvent,
    TtsEndEvent,
    TtsStartEvent,
    TurnEndEvent,
    TurnStartEvent,
    WireEvent,
)

EventEmitter = Callable[[WireEvent], Awaitable[None]]


def _now_ms() -> int:
    return int(time.time() * 1000)


class Pipeline(Protocol):
    async def start(self, config: dict) -> None: ...
    async def stop(self) -> None: ...
    async def handle_text(self, text: str, turn_id: str | None) -> None: ...
    async def handle_audio(self, audio_b64: str, sample_rate: int) -> None: ...
    async def barge_in(self) -> None: ...


class MockPipeline:
    """Simulates a TTS loop on asyncio timers.

    Enqueues `handle_text` calls and drains them sequentially. Each drains to
    turn_start → tts_start → sleep(proportional) → tts_end → turn_end.
    """

    def __init__(self, emit: EventEmitter) -> None:
        self._emit = emit
        self._queue: asyncio.Queue[tuple[str, str | None]] = asyncio.Queue()
        self._worker: asyncio.Task[None] | None = None
        self._current: asyncio.Task[None] | None = None

    async def start(self, config: dict) -> None:
        self._worker = asyncio.create_task(self._worker_loop())

    async def stop(self) -> None:
        await self.barge_in()
        if self._worker is not None:
            self._worker.cancel()
            try:
                await self._worker
            except (asyncio.CancelledError, Exception):
                pass
            self._worker = None

    async def handle_text(self, text: str, turn_id: str | None) -> None:
        await self._queue.put((text, turn_id))

    async def handle_audio(self, audio_b64: str, sample_rate: int) -> None:
        # Mock pipeline ignores inbound audio. Real pipeline will route to STT.
        return None

    async def barge_in(self) -> None:
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        task = self._current
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._current = None

    async def _worker_loop(self) -> None:
        while True:
            text, turn_id = await self._queue.get()
            tid = turn_id or f"t-{uuid4().hex[:8]}"
            self._current = asyncio.create_task(self._synthesize(tid, text))
            try:
                await self._current
            except asyncio.CancelledError:
                # barge_in cancelled this one; loop to next item
                pass
            except Exception:
                pass
            self._current = None

    async def _synthesize(self, turn_id: str, text: str) -> None:
        try:
            await self._emit(
                TurnStartEvent(timestamp=_now_ms(), turn_id=turn_id, role="assistant"),
            )
            chunks = _split_into_chunks(text)
            for i, chunk in enumerate(chunks):
                chunk_id = f"c-{i}"
                await self._emit(
                    TtsStartEvent(timestamp=_now_ms(), turn_id=turn_id, chunk_id=chunk_id),
                )
                # ~40ms per character as a naive speaking-rate simulation.
                await asyncio.sleep(min(2.0, 0.04 * len(chunk)))
                await self._emit(
                    TtsEndEvent(timestamp=_now_ms(), turn_id=turn_id, chunk_id=chunk_id),
                )
            await self._emit(
                TurnEndEvent(timestamp=_now_ms(), turn_id=turn_id, role="assistant"),
            )
        except asyncio.CancelledError:
            await self._emit(
                BargeInDetectedEvent(timestamp=_now_ms(), turn_id=turn_id),
            )
            raise
        except Exception as exc:  # noqa: BLE001
            await self._emit(
                ErrorEvent(
                    timestamp=_now_ms(),
                    message=f"synthesis failed: {exc}",
                    retriable=False,
                ),
            )


def _split_into_chunks(text: str) -> list[str]:
    # Naive sentence-boundary split. Real chunker lands in @kith/voice-router.
    import re

    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p for p in parts if p]
