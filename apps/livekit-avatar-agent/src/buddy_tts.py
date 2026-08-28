"""LiveKit TTS provider backed only by Buddy's voice runtime."""

from __future__ import annotations

import asyncio
import logging
import os

import aiohttp
from livekit.agents import APIConnectOptions, tts, utils
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS

logger = logging.getLogger("buddys.avatar.tts")


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class _PreAudioFailure(RuntimeError):
    pass


class _MidStreamFailure(RuntimeError):
    pass


class BuddyRuntimeTTS(tts.TTS):
    """Synthesizes Buddy's configured voice without cross-product fallbacks."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        token: str | None = None,
        voice_id: str = "buddy",
        streaming_pcm: bool | None = None,
    ) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=24000,
            num_channels=1,
        )
        self.base_url = (
            base_url
            or os.environ.get("BLACKHOLE_BUDDYS_RUNTIME_URL", "")
            or os.environ.get("BUDDY_RUNTIME_URL", "")
        ).rstrip("/")
        self.token = (
            token
            or os.environ.get("BLACKHOLE_BUDDYS_RUNTIME_TOKEN", "")
            or os.environ.get("BUDDY_RUNTIME_TOKEN", "")
        )
        self.voice_id = voice_id
        self.streaming_pcm = (
            _env_bool("BUDDY_LIVEKIT_STREAMING_TTS", True)
            if streaming_pcm is None
            else streaming_pcm
        )
        if not self.base_url:
            raise ValueError("BLACKHOLE_BUDDYS_RUNTIME_URL is required")
        if not self.token:
            raise ValueError("BLACKHOLE_BUDDYS_RUNTIME_TOKEN is required")

    @property
    def provider(self) -> str:
        return "Buddy Runtime"

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> "BuddyChunkedStream":
        return BuddyChunkedStream(tts=self, input_text=text, conn_options=conn_options)

    async def aclose(self) -> None:
        return None


class BuddyChunkedStream(tts.ChunkedStream):
    def __init__(
        self,
        *,
        tts: BuddyRuntimeTTS,
        input_text: str,
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self.runtime = tts

    async def _post_pcm(self, output_emitter: tts.AudioEmitter, endpoint: str) -> None:
        session = utils.http_context.http_session()
        timeout = aiohttp.ClientTimeout(total=120, sock_connect=self._conn_options.timeout)
        emitted = False

        try:
            async with session.post(
                f"{self.runtime.base_url}{endpoint}",
                headers={
                    "content-type": "application/json",
                    "x-runtime-token": self.runtime.token,
                },
                json={"text": self._input_text, "voiceId": self.runtime.voice_id},
                timeout=timeout,
            ) as response:
                if response.status != 200:
                    detail = await response.text()
                    raise _PreAudioFailure(
                        f"Buddy runtime TTS failed ({response.status}): {detail[:300]}"
                    )

                async for chunk in response.content.iter_chunked(4800):
                    if not chunk:
                        continue
                    if not emitted:
                        output_emitter.initialize(
                            request_id=utils.shortuuid(),
                            sample_rate=24000,
                            num_channels=1,
                            mime_type="audio/pcm",
                        )
                        emitted = True
                    output_emitter.push(chunk)

                if not emitted:
                    raise _PreAudioFailure("Buddy runtime returned no PCM audio")
        except asyncio.CancelledError:
            raise
        except (_MidStreamFailure, _PreAudioFailure):
            raise
        except Exception as exc:
            if emitted:
                raise _MidStreamFailure(
                    f"Buddy runtime stream failed after audio began: {exc}"
                ) from exc
            raise _PreAudioFailure(f"Buddy runtime request failed: {exc}") from exc

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        if self.runtime.streaming_pcm:
            try:
                await self._post_pcm(output_emitter, "/tts/livekit/stream")
                return
            except _PreAudioFailure as exc:
                logger.warning(
                    "Streaming Buddy TTS failed before first PCM; using legacy endpoint: %s",
                    exc,
                )

        await self._post_pcm(output_emitter, "/tts/livekit")

