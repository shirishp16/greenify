from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass
class SmartPlugResult:
    success: bool
    message: str


class SmartPlugService:
    def set_power(self, device_id: str, turn_on: bool) -> SmartPlugResult:
        raise NotImplementedError


class MockSmartPlugService(SmartPlugService):
    def set_power(self, device_id: str, turn_on: bool) -> SmartPlugResult:
        state = "on" if turn_on else "off"
        return SmartPlugResult(
            success=True,
            message=f"Mock smart plug acknowledged {device_id} -> {state}.",
        )


class OptionalRealSmartPlugService(SmartPlugService):
    def __init__(self) -> None:
        self.enabled = os.getenv("REAL_SMART_PLUG_ENABLED", "false").lower() == "true"
        self.api_key = os.getenv("REAL_SMART_PLUG_API_KEY", "")

    def set_power(self, device_id: str, turn_on: bool) -> SmartPlugResult:
        if not self.enabled or not self.api_key:
            return SmartPlugResult(
                success=False,
                message=(
                    "Real smart plug adapter is disabled. "
                    "Set REAL_SMART_PLUG_ENABLED=true and provide REAL_SMART_PLUG_API_KEY."
                ),
            )

        state = "on" if turn_on else "off"
        return SmartPlugResult(
            success=True,
            message=f"Real smart plug adapter stub would set {device_id} -> {state}.",
        )


def build_smart_plug_service() -> SmartPlugService:
    real_service = OptionalRealSmartPlugService()
    if real_service.enabled and real_service.api_key:
        return real_service
    return MockSmartPlugService()
