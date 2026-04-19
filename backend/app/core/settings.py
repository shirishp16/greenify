from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-latest")
    anthropic_max_tokens: int = int(os.getenv("ANTHROPIC_MAX_TOKENS", "1500"))
    anthropic_temperature: float = float(os.getenv("ANTHROPIC_TEMPERATURE", "0"))


settings = Settings()
