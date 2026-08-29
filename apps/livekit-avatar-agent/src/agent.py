"""Buddy-owned LiveKit, LemonSlice, STT, LLM, and TTS runtime."""

from __future__ import annotations

import json
import logging
import os
import pathlib
from urllib.parse import quote

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentServer, AgentSession, TurnHandlingOptions, inference, room_io
from livekit.plugins import lemonslice, noise_cancellation, openai

from buddy_tts import BuddyRuntimeTTS

APP_ROOT = pathlib.Path(__file__).resolve().parents[1]
load_dotenv(APP_ROOT / ".env.local")
load_dotenv(APP_ROOT / ".env")

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("buddys.avatar")

TENANT_ID = "buddys"
AGENT_NAME = os.getenv("AGENT_NAME", "buddys-avatar").strip() or "buddys-avatar"
AGENT_HTTP_PORT = int(os.getenv("AGENT_HTTP_PORT", "8092"))
RELAY_BASE_URL = os.getenv(
    "BUDDYS_VIDEO_RELAY_URL",
    "https://buddys-video-worker.cryptocapitalgroupfl.workers.dev/internal/lemonslice/sessions",
).strip()


class Assistant(Agent):
    def __init__(self, instructions: str) -> None:
        super().__init__(instructions=instructions)


def required(data: dict, key: str) -> str:
    value = str(data.get(key) or "").strip()
    if not value:
        raise RuntimeError(f"Missing required dispatch metadata: {key}")
    return value


def metadata_for(ctx: agents.JobContext) -> dict:
    if not ctx.job.metadata:
        raise RuntimeError("Dispatch metadata is required")
    try:
        data = json.loads(ctx.job.metadata)
    except Exception as exc:
        raise RuntimeError("Invalid dispatch metadata JSON") from exc
    if not isinstance(data, dict):
        raise RuntimeError("Dispatch metadata must be an object")
    if required(data, "tenant_id") != TENANT_ID:
        raise RuntimeError("Buddy agent only accepts tenant_id=buddys")
    return data


def avatar_options(metadata: dict) -> dict:
    source = required(metadata, "avatar_source").lower()
    if required(metadata, "avatar_provider").lower() != "lemonslice":
        raise RuntimeError("Buddy avatar_provider must be lemonslice")
    if source == "agent-id":
        logger.info("AVATAR_SOURCE source=agent-id")
        return {"agent_id": required(metadata, "lemonslice_agent_id")}
    if source == "image-url":
        logger.info("AVATAR_SOURCE source=image-url")
        return {"agent_image_url": required(metadata, "avatar_image_url")}
    raise RuntimeError(f"Unsupported Buddy avatar_source: {source}")


def build_tts(metadata: dict) -> BuddyRuntimeTTS:
    if required(metadata, "voice_provider").lower() != "eila-runtime":
        raise RuntimeError("Buddy voice_provider must be eila-runtime")
    voice = required(metadata, "voice_id")
    logger.info("TTS_SOURCE provider=buddy-runtime voice=%s", voice)
    return BuddyRuntimeTTS(voice_id=voice)


def text_input_handler(session: AgentSession, event: room_io.TextInputEvent) -> None:
    message = str(event.text or "").strip()
    if not message:
        return
    logger.info("TEXT_INPUT source=lk.chat characters=%s", len(message))
    session.interrupt()
    session.generate_reply(user_input=message)


server = AgentServer(port=AGENT_HTTP_PORT)


@server.rtc_session(agent_name=AGENT_NAME)
async def buddys_avatar_agent(ctx: agents.JobContext) -> None:
    metadata = metadata_for(ctx)
    creator_name = required(metadata, "creator_name")
    instructions = required(metadata, "instructions")
    relay_room = required(metadata, "relay_room")
    relay_token = required(metadata, "relay_token")

    logger.info("JOB_START room=%s agent=%s", relay_room, AGENT_NAME)
    session = AgentSession(
        llm=openai.LLM.with_ollama(
            model=os.getenv("LOCAL_LLM_MODEL", "qwen3.5:9b"),
            base_url=os.getenv("LOCAL_LLM_BASE_URL", "http://127.0.0.1:11434/v1"),
            temperature=float(os.getenv("LOCAL_LLM_TEMPERATURE", "0.35")),
            reasoning_effort=os.getenv("LOCAL_LLM_REASONING_EFFORT", "none"),
        ),
        stt=inference.STT(
            model=os.getenv("LIVEKIT_STT_MODEL", "deepgram/nova-3"),
            language="en",
        ),
        tts=build_tts(metadata),
        turn_handling=TurnHandlingOptions(
            turn_detection=inference.TurnDetector(),
            endpointing={"mode": "dynamic", "min_delay": 0.25, "max_delay": 1.2, "alpha": 0.65},
            interruption={
                "mode": "adaptive",
                "min_duration": 0.7,
                "min_words": 1,
                "resume_false_interruption": False,
            },
            preemptive_generation={"preemptive_tts": True},
        ),
    )

    await ctx.connect()
    separator = "&" if "?" in RELAY_BASE_URL else "?"
    relay_url = (
        f"{RELAY_BASE_URL}{separator}tenant={quote(TENANT_ID)}"
        f"&room={quote(relay_room)}"
    )
    avatar = lemonslice.AvatarSession(
        **avatar_options(metadata),
        agent_prompt=str(metadata.get("avatar_prompt") or "a friendly personal shopper talking").strip(),
        agent_idle_prompt=str(metadata.get("avatar_idle_prompt") or "a friendly personal shopper listening").strip(),
        api_url=relay_url,
        api_key=relay_token,
    )

    logger.info("RELAY_START room=%s", relay_room)
    await avatar.start(session, room=ctx.room)
    logger.info("RELAY_CONNECTED room=%s", relay_room)

    await session.start(
        room=ctx.room,
        agent=Assistant(instructions=instructions),
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(noise_cancellation=noise_cancellation.BVC()),
            audio_output=False,
            text_input=room_io.TextInputOptions(text_input_cb=text_input_handler),
            text_output=True,
        ),
    )
    await avatar.wait_for_join()
    logger.info("AVATAR_JOINED room=%s", relay_room)
    await session.generate_reply(
        instructions=f"Greet the customer naturally as {creator_name}. Keep it brief and stay in character.",
    )


if __name__ == "__main__":
    agents.cli.run_app(server)

