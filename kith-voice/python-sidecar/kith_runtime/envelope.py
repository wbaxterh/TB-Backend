"""Wire-protocol models.

Mirrors docs/protocol.md and the `KithEvent` union in @kith/core.
Field names are emitted as camelCase to match the TypeScript surface
directly — the Python side uses snake_case internally and pydantic
handles the alias.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

PROTOCOL_VERSION = 0


class _WireModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
    )


# -----------------------------------------------------------------------------
# TS → Python ops
# -----------------------------------------------------------------------------


class HelloOp(_WireModel):
    v: Literal[0] = 0
    op: Literal["hello"] = "hello"
    session_id: str
    config: dict[str, Any] = Field(default_factory=dict)


class SendTextOp(_WireModel):
    v: Literal[0] = 0
    op: Literal["sendText"] = "sendText"
    text: str
    turn_id: str | None = None


class SendAudioOp(_WireModel):
    v: Literal[0] = 0
    op: Literal["sendAudio"] = "sendAudio"
    audio_b64: str
    sample_rate: int
    mime_type: str = "audio/l16"


class BargeInOp(_WireModel):
    v: Literal[0] = 0
    op: Literal["bargeIn"] = "bargeIn"


class DisconnectOp(_WireModel):
    v: Literal[0] = 0
    op: Literal["disconnect"] = "disconnect"


Op = Annotated[
    Union[HelloOp, SendTextOp, SendAudioOp, BargeInOp, DisconnectOp],
    Field(discriminator="op"),
]


class OpEnvelope(_WireModel):
    root: Op = Field(discriminator="op")


# -----------------------------------------------------------------------------
# Python → TS events
# -----------------------------------------------------------------------------


class _Event(_WireModel):
    v: Literal[0] = 0
    timestamp: int


class ReadyEvent(_Event):
    event: Literal["ready"] = "ready"


class TurnStartEvent(_Event):
    event: Literal["turn_start"] = "turn_start"
    turn_id: str
    role: Literal["user", "assistant"]


class TurnEndEvent(_Event):
    event: Literal["turn_end"] = "turn_end"
    turn_id: str
    role: Literal["user", "assistant"]


class TtsStartEvent(_Event):
    event: Literal["tts_start"] = "tts_start"
    turn_id: str
    chunk_id: str


class TtsAudioChunkEvent(_Event):
    event: Literal["tts_audio_chunk"] = "tts_audio_chunk"
    turn_id: str
    chunk_id: str
    audio_b64: str
    mime_type: str


class TtsEndEvent(_Event):
    event: Literal["tts_end"] = "tts_end"
    turn_id: str
    chunk_id: str


class SttPartialEvent(_Event):
    event: Literal["stt_partial"] = "stt_partial"
    turn_id: str
    text: str


class SttFinalEvent(_Event):
    event: Literal["stt_final"] = "stt_final"
    turn_id: str
    text: str


class VisemeFrameEvent(_Event):
    event: Literal["viseme_frame"] = "viseme_frame"
    turn_id: str
    viseme: str
    weight: float
    offset_ms: int


class EmotionStateEvent(_Event):
    event: Literal["emotion_state"] = "emotion_state"
    state: str
    intensity: float


class BargeInDetectedEvent(_Event):
    event: Literal["barge_in_detected"] = "barge_in_detected"
    turn_id: str


class ReconnectEvent(_Event):
    event: Literal["reconnect"] = "reconnect"
    attempt: int


class ErrorEvent(_Event):
    event: Literal["error"] = "error"
    message: str
    retriable: bool


WireEvent = Union[
    ReadyEvent,
    TurnStartEvent,
    TurnEndEvent,
    TtsStartEvent,
    TtsAudioChunkEvent,
    TtsEndEvent,
    SttPartialEvent,
    SttFinalEvent,
    VisemeFrameEvent,
    EmotionStateEvent,
    BargeInDetectedEvent,
    ReconnectEvent,
    ErrorEvent,
]


def serialize(event: WireEvent) -> str:
    return event.model_dump_json(by_alias=True)
