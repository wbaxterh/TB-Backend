"""Real TTS pipeline backed by the ElevenLabs Python SDK.

Design note: v0.1 uses the ElevenLabs SDK directly rather than wrapping
Pipecat's `ElevenLabsTTSService` inside a full `pipecat.Pipeline`. The
framework choice (Pipecat primary) remains correct — its pipeline
composability becomes load-bearing once we have multi-processor stages
(STT → policy → TTS) in the sidecar. For a single-service TTS path,
wrapping adds complexity without leverage. The `Pipeline` protocol is
identical either way, so a future swap to Pipecat happens behind this
module's boundary.
"""

from __future__ import annotations

import asyncio
import base64
import glob
import os
import pathlib
import random
import re
import time
from collections.abc import Awaitable, Callable
from uuid import uuid4

from elevenlabs.client import ElevenLabs

from .envelope import (
    BargeInDetectedEvent,
    ErrorEvent,
    TtsAudioChunkEvent,
    TtsEndEvent,
    TtsStartEvent,
    TurnEndEvent,
    TurnStartEvent,
    WireEvent,
)

EventEmitter = Callable[[WireEvent], Awaitable[None]]


def _now_ms() -> int:
    return int(time.time() * 1000)


def _split_into_sentences(text: str) -> list[str]:
    """Naive sentence split on terminal punctuation.

    The canonical sentence-aware chunker lives in `@kith/voice-router`
    (Day 5 in the phase-1 plan). This minimal version exists so the
    Python sidecar produces natural-sounding chunks even when a consumer
    calls `sendText` directly without passing through voice-router.
    """
    import re

    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p for p in parts if p]


# Laughter markers. `[chuckle]` is what the LLM is instructed to emit; the rest
# are a safety net for stray typed-out laughter so it becomes a real chuckle
# clip instead of being read aloud ("haha", "lol", …).
_CHUCKLE_RE = re.compile(
    r"\[chuckles?[^\]]*\]"
    r"|\[laughs?[^\]]*\]"
    r"|\bha(?:ha)+\b"
    r"|\bhe(?:he)+\b"
    r"|\blo+l\b"
    r"|\blmf?ao\b",
    re.IGNORECASE,
)


def _tokenize_with_chuckles(text: str) -> list[tuple[str, str]]:
    """Split text into an ordered list of ('text', str) / ('chuckle', '') segments."""
    out: list[tuple[str, str]] = []
    last = 0
    for m in _CHUCKLE_RE.finditer(text):
        pre = text[last : m.start()]
        if pre.strip():
            out.append(("text", pre))
        out.append(("chuckle", ""))
        last = m.end()
    tail = text[last:]
    if tail.strip():
        out.append(("text", tail))
    return out


class ElevenLabsPipeline:
    """Pipeline that synthesizes text via ElevenLabs and streams audio back.

    Config keys honored from the `hello` op:
      - `apiKey`: overrides ELEVENLABS_API_KEY env var.
      - `voiceId`: required for synthesis.
      - `modelId`: defaults to `eleven_multilingual_v2`.
      - `stability`, `similarityBoost`, `style`, `useSpeakerBoost`: voice settings.
      - `outputFormat`: e.g. `mp3_44100_128` (default), `pcm_16000`.
    """

    DEFAULT_MODEL = "eleven_multilingual_v2"
    DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"

    def __init__(self, emit: EventEmitter) -> None:
        self._emit = emit
        self._client: ElevenLabs | None = None
        self._voice_id: str | None = None
        self._model_id = self.DEFAULT_MODEL
        self._output_format = self.DEFAULT_OUTPUT_FORMAT
        self._voice_settings: dict | None = None
        self._queue: asyncio.Queue[tuple[str, str | None]] = asyncio.Queue()
        self._worker: asyncio.Task[None] | None = None
        self._current: asyncio.Task[None] | None = None
        # Pre-rendered laugh clips (bytes, same audio format as output). A
        # `[chuckle]` marker in the text emits one of these instead of TTS —
        # Flash/Turbo can't do v3's expressive laughs, so we splice real ones in.
        self._chuckle_clips: list[bytes] = []

    async def start(self, config: dict) -> None:
        api_key = config.get("apiKey") or os.environ.get("ELEVENLABS_API_KEY")
        voice_id = config.get("voiceId") or os.environ.get("ELEVENLABS_VOICE_ID")
        if not api_key:
            raise RuntimeError("elevenlabs pipeline requires apiKey (or ELEVENLABS_API_KEY env)")
        if not voice_id:
            raise RuntimeError("elevenlabs pipeline requires voiceId (or ELEVENLABS_VOICE_ID env)")

        self._client = ElevenLabs(api_key=api_key)
        self._voice_id = voice_id
        self._model_id = config.get("modelId", self.DEFAULT_MODEL)
        self._output_format = config.get("outputFormat", self.DEFAULT_OUTPUT_FORMAT)

        settings = {
            k: config[k]
            for k in ("stability", "similarityBoost", "style", "useSpeakerBoost", "speed")
            if k in config
        }
        # ElevenLabs SDK expects snake_case for voice settings.
        renamed = {
            "stability": settings.get("stability"),
            "similarity_boost": settings.get("similarityBoost"),
            "style": settings.get("style"),
            "use_speaker_boost": settings.get("useSpeakerBoost"),
            "speed": settings.get("speed"),
        }
        self._voice_settings = {k: v for k, v in renamed.items() if v is not None} or None

        # Load laugh clips (mp3, must match output format) from the chuckle dir.
        chuckle_dir = (
            config.get("chuckleDir")
            or os.environ.get("KITH_CHUCKLE_DIR")
            or str(pathlib.Path(__file__).resolve().parents[2] / "assets" / "chuckles")
        )
        self._chuckle_clips = []
        try:
            for p in sorted(glob.glob(os.path.join(chuckle_dir, "*.mp3"))):
                self._chuckle_clips.append(pathlib.Path(p).read_bytes())
        except OSError:
            pass

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
        if self._client is None or self._voice_id is None:
            await self._emit(
                ErrorEvent(timestamp=_now_ms(), message="pipeline not started", retriable=False),
            )
            return
        await self._queue.put((text, turn_id))

    async def handle_audio(self, audio_b64: str, sample_rate: int) -> None:
        # STT path is not wired in v0.1; inbound audio is dropped.
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
                pass
            except Exception:
                pass
            self._current = None

    async def _synthesize(self, turn_id: str, text: str) -> None:
        try:
            await self._emit(
                TurnStartEvent(timestamp=_now_ms(), turn_id=turn_id, role="assistant"),
            )
            idx = 0
            for seg_type, seg_text in _tokenize_with_chuckles(text):
                if seg_type == "chuckle":
                    await self._emit_chuckle(turn_id, f"c-{idx}")
                    idx += 1
                    continue
                for sentence in _split_into_sentences(seg_text):
                    await self._synthesize_chunk(turn_id, f"c-{idx}", sentence)
                    idx += 1
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

    async def _emit_chuckle(self, turn_id: str, chunk_id: str) -> None:
        """Emit a pre-rendered laugh clip as an audio chunk (in place of a
        `[chuckle]` marker). No-op if no clips are installed."""
        if not self._chuckle_clips:
            return
        clip = random.choice(self._chuckle_clips)
        await self._emit(
            TtsStartEvent(timestamp=_now_ms(), turn_id=turn_id, chunk_id=chunk_id),
        )
        await self._emit(
            TtsAudioChunkEvent(
                timestamp=_now_ms(),
                turn_id=turn_id,
                chunk_id=chunk_id,
                audio_b64=base64.b64encode(clip).decode("ascii"),
                mime_type="audio/mpeg",
            ),
        )
        await self._emit(
            TtsEndEvent(timestamp=_now_ms(), turn_id=turn_id, chunk_id=chunk_id),
        )

    async def _synthesize_chunk(self, turn_id: str, chunk_id: str, text: str) -> None:
        assert self._client is not None and self._voice_id is not None
        await self._emit(
            TtsStartEvent(timestamp=_now_ms(), turn_id=turn_id, chunk_id=chunk_id),
        )

        mime = _mime_for_format(self._output_format)

        def synthesize_blocking() -> bytes:
            assert self._client is not None and self._voice_id is not None
            kwargs: dict = {
                "voice_id": self._voice_id,
                "text": text,
                "model_id": self._model_id,
                "output_format": self._output_format,
            }
            if self._voice_settings is not None:
                kwargs["voice_settings"] = self._voice_settings
            audio_iter = self._client.text_to_speech.convert(**kwargs)
            return b"".join(audio_iter)

        audio_bytes = await asyncio.to_thread(synthesize_blocking)

        await self._emit(
            TtsAudioChunkEvent(
                timestamp=_now_ms(),
                turn_id=turn_id,
                chunk_id=chunk_id,
                audio_b64=base64.b64encode(audio_bytes).decode("ascii"),
                mime_type=mime,
            ),
        )
        await self._emit(
            TtsEndEvent(timestamp=_now_ms(), turn_id=turn_id, chunk_id=chunk_id),
        )


def _mime_for_format(fmt: str) -> str:
    if fmt.startswith("mp3"):
        return "audio/mpeg"
    if fmt.startswith("pcm"):
        return "audio/l16"
    if fmt.startswith("ulaw"):
        return "audio/basic"
    return "application/octet-stream"
