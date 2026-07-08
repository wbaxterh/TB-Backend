"""WebSocket server for the Kith runtime sidecar.

Accepts a single client connection (per design — one sidecar per session),
dispatches ops to the pipeline, and forwards pipeline events back out.
"""

from __future__ import annotations

import asyncio
import json
import signal
import sys
import time
from typing import Any

from pydantic import TypeAdapter, ValidationError
from websockets.asyncio.server import ServerConnection, serve

from .elevenlabs_pipeline import ElevenLabsPipeline
from .envelope import (
    ErrorEvent,
    Op,
    ReadyEvent,
    WireEvent,
    serialize,
)
from .pipeline import MockPipeline, Pipeline

_PIPELINES: dict[str, type[Pipeline]] = {
    "mock": MockPipeline,
    "elevenlabs": ElevenLabsPipeline,
}

OpAdapter: TypeAdapter[Op] = TypeAdapter(Op)


def _now_ms() -> int:
    return int(time.time() * 1000)


class RuntimeServer:
    def __init__(self, default_pipeline: str = "mock") -> None:
        self._default_pipeline = default_pipeline
        self._pipeline: Pipeline | None = None
        self._ws: ServerConnection | None = None
        self._shutdown = asyncio.Event()

    async def _emit(self, event: WireEvent) -> None:
        ws = self._ws
        if ws is None:
            return
        await ws.send(serialize(event))

    async def _handle_client(self, ws: ServerConnection) -> None:
        if self._ws is not None:
            await ws.close(code=1008, reason="sidecar already bound to a client")
            return
        self._ws = ws

        try:
            async for raw in ws:
                await self._handle_message(raw)
        finally:
            if self._pipeline is not None:
                await self._pipeline.stop()
            self._pipeline = None
            self._ws = None
            self._shutdown.set()

    async def _handle_message(self, raw: Any) -> None:
        try:
            data = json.loads(raw)
            op = OpAdapter.validate_python(data)
        except (json.JSONDecodeError, ValidationError) as exc:
            await self._emit(
                ErrorEvent(timestamp=_now_ms(), message=f"bad envelope: {exc}", retriable=False),
            )
            return

        if op.op == "hello":
            kind = op.config.get("pipeline", self._default_pipeline)
            if kind not in _PIPELINES:
                await self._emit(
                    ErrorEvent(
                        timestamp=_now_ms(),
                        message=f"unknown pipeline: {kind}",
                        retriable=False,
                    ),
                )
                return
            self._pipeline = _PIPELINES[kind](self._emit)
            try:
                await self._pipeline.start(op.config)
            except Exception as exc:  # noqa: BLE001
                self._pipeline = None
                await self._emit(
                    ErrorEvent(
                        timestamp=_now_ms(),
                        message=f"pipeline {kind} start failed: {exc}",
                        retriable=False,
                    ),
                )
                return
            await self._emit(ReadyEvent(timestamp=_now_ms()))
            return

        pipeline = self._pipeline
        if pipeline is None:
            return

        match op.op:
            case "sendText":
                await pipeline.handle_text(op.text, op.turn_id)
            case "sendAudio":
                await pipeline.handle_audio(op.audio_b64, op.sample_rate)
            case "bargeIn":
                await pipeline.barge_in()
            case "disconnect":
                await pipeline.stop()
                assert self._ws is not None
                await self._ws.close()

    async def serve_forever(self) -> None:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, self._shutdown.set)

        async with serve(self._handle_client, "127.0.0.1", 0) as server:
            sockets = server.sockets or []
            assert sockets, "server bound no sockets"
            port = sockets[0].getsockname()[1]
            # Protocol §startup — the TS adapter parses this line.
            print(f"KITH_RUNTIME_READY port={port}", flush=True)
            await self._shutdown.wait()


async def main() -> None:
    await RuntimeServer().serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
