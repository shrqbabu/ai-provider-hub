"""LLM abstraction.

Supports:
  * OpenAI-compatible chat completions (OpenAI, Azure-compatible gateways,
    OpenRouter, local vLLM, the AI Provider Hub gateway in this repo, ...)
  * Google Gemini AI Studio (``generativelanguage.googleapis.com``)
  * A deterministic offline generator used when no key is configured, so the
    pipeline, CI and tests always run end to end.

Hard rules enforced here:
  * The LLM never performs arithmetic that ends up in a delivered number.
    It only receives already-computed metric values and writes narrative.
  * All JSON responses are schema-checked; a malformed response falls back to
    the deterministic generator instead of guessing.
"""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx

from ..config import Settings, get_settings

log = logging.getLogger(__name__)


@dataclass
class LlmUsage:
    provider: str = "deterministic"
    model: str = ""
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_ms: int = 0
    errors: List[str] = field(default_factory=list)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "provider": self.provider,
            "model": self.model,
            "calls": self.calls,
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_ms": self.total_ms,
            "errors": self.errors[:10],
        }


class LlmError(RuntimeError):
    pass


def _extract_json(text: str) -> Optional[Any]:
    """Pull the first JSON object/array out of a model response."""
    if not text:
        return None
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        end = text.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue
    return None


class LlmClient:
    """Thin, provider-agnostic chat client."""

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self.settings = settings or get_settings()
        self.provider = self.settings.resolved_llm_provider()
        self.model = {
            "openai": self.settings.openai_model,
            "gemini": self.settings.gemini_model,
        }.get(self.provider, "deterministic")
        self.usage = LlmUsage(provider=self.provider, model=self.model)

    # -- public ------------------------------------------------------------
    @property
    def available(self) -> bool:
        return self.provider in {"openai", "gemini"}

    def complete_json(
        self,
        system: str,
        user: str,
        *,
        fallback: Any,
        temperature: float = 0.2,
    ) -> Any:
        """Ask for JSON. Never raises: falls back deterministically."""
        if not self.available:
            return fallback
        try:
            raw = self._chat(system, user, temperature=temperature, json_mode=True)
        except Exception as exc:  # noqa: BLE001 - provider errors must not kill a run
            log.warning("LLM call failed (%s): %s", self.provider, exc)
            self.usage.errors.append(f"{type(exc).__name__}: {exc}"[:300])
            return fallback
        parsed = _extract_json(raw)
        if parsed is None:
            self.usage.errors.append("unparseable_json_response")
            return fallback
        return parsed

    def complete_text(self, system: str, user: str, *, fallback: str = "", temperature: float = 0.3) -> str:
        if not self.available:
            return fallback
        try:
            return self._chat(system, user, temperature=temperature, json_mode=False).strip() or fallback
        except Exception as exc:  # noqa: BLE001
            log.warning("LLM text call failed (%s): %s", self.provider, exc)
            self.usage.errors.append(f"{type(exc).__name__}: {exc}"[:300])
            return fallback

    # -- providers ---------------------------------------------------------
    def _chat(self, system: str, user: str, *, temperature: float, json_mode: bool) -> str:
        started = time.time()
        try:
            if self.provider == "openai":
                text = self._chat_openai(system, user, temperature, json_mode)
            elif self.provider == "gemini":
                text = self._chat_gemini(system, user, temperature, json_mode)
            else:  # pragma: no cover - guarded by `available`
                raise LlmError("no provider configured")
        finally:
            self.usage.calls += 1
            self.usage.total_ms += int((time.time() - started) * 1000)
        return text

    def _chat_openai(self, system: str, user: str, temperature: float, json_mode: bool) -> str:
        s = self.settings
        payload: Dict[str, Any] = {
            "model": s.openai_model,
            "temperature": temperature,
            "max_tokens": s.llm_max_output_tokens,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        with httpx.Client(timeout=s.llm_timeout_seconds) as client:
            resp = client.post(
                f"{s.openai_base_url.rstrip('/')}/chat/completions",
                headers={
                    "Authorization": f"Bearer {s.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if resp.status_code >= 400:
            raise LlmError(f"openai http {resp.status_code}: {resp.text[:300]}")
        body = resp.json()
        usage = body.get("usage") or {}
        self.usage.prompt_tokens += int(usage.get("prompt_tokens") or 0)
        self.usage.completion_tokens += int(usage.get("completion_tokens") or 0)
        choices = body.get("choices") or []
        if not choices:
            raise LlmError("openai: empty choices")
        return choices[0].get("message", {}).get("content") or ""

    def _chat_gemini(self, system: str, user: str, temperature: float, json_mode: bool) -> str:
        s = self.settings
        gen_config: Dict[str, Any] = {
            "temperature": temperature,
            "maxOutputTokens": s.llm_max_output_tokens,
        }
        if json_mode:
            gen_config["responseMimeType"] = "application/json"
        payload = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": gen_config,
        }
        url = f"{s.gemini_base_url.rstrip('/')}/models/{s.gemini_model}:generateContent"
        with httpx.Client(timeout=s.llm_timeout_seconds) as client:
            resp = client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": s.gemini_api_key,
                },
                json=payload,
            )
        if resp.status_code >= 400:
            raise LlmError(f"gemini http {resp.status_code}: {resp.text[:300]}")
        body = resp.json()
        meta = body.get("usageMetadata") or {}
        self.usage.prompt_tokens += int(meta.get("promptTokenCount") or 0)
        self.usage.completion_tokens += int(meta.get("candidatesTokenCount") or 0)
        candidates = body.get("candidates") or []
        if not candidates:
            raise LlmError("gemini: empty candidates")
        parts = (candidates[0].get("content") or {}).get("parts") or []
        return "".join(p.get("text", "") for p in parts)
