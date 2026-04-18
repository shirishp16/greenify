from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass

import httpx


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


class AppleShortcutsSmartPlugService(SmartPlugService):
    """Drive the plug via Apple Home by shelling out to macOS `shortcuts`.

    Each Greenify device id maps to two Shortcut names via env vars:
      APPLE_SHORTCUT_<DEVICE_ID_UPPER>_ON
      APPLE_SHORTCUT_<DEVICE_ID_UPPER>_OFF
    The Shortcut itself contains a "Home: Set <accessory>" action.
    """

    RUN_TIMEOUT_SECONDS = 8.0

    def __init__(self, shortcut_map: dict[str, tuple[str, str]]) -> None:
        self.shortcut_map = shortcut_map

    def set_power(self, device_id: str, turn_on: bool) -> SmartPlugResult:
        pair = self.shortcut_map.get(device_id)
        if not pair:
            return SmartPlugResult(
                success=False,
                message=f"No Apple Shortcut mapped for device '{device_id}'.",
            )
        name = pair[0] if turn_on else pair[1]
        try:
            proc = subprocess.run(
                ["shortcuts", "run", name],
                capture_output=True,
                text=True,
                timeout=self.RUN_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            return SmartPlugResult(
                success=False,
                message=f"Apple Shortcut '{name}' timed out.",
            )
        except FileNotFoundError:
            return SmartPlugResult(
                success=False,
                message="macOS `shortcuts` CLI not found (non-macOS host?).",
            )
        if proc.returncode != 0:
            return SmartPlugResult(
                success=False,
                message=f"Apple Shortcut '{name}' failed: {proc.stderr.strip() or proc.stdout.strip()}",
            )
        state = "on" if turn_on else "off"
        return SmartPlugResult(
            success=True,
            message=f"Apple Shortcut '{name}' ran ({device_id} -> {state}).",
        )


class HomeAssistantSmartPlugService(SmartPlugService):
    """Talks to a local Home Assistant via its REST API.

    HA fronts a python-matter-server sidecar which owns the Matter fabric the
    GE Cync plug is commissioned into. Each Greenify device id is mapped to an
    HA entity id through env vars of the form HA_ENTITY_ID_<DEVICE_ID_UPPER>.
    """

    REQUEST_TIMEOUT_SECONDS = 2.0

    def __init__(self, base_url: str, token: str, entity_map: dict[str, str]) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.entity_map = entity_map

    def set_power(self, device_id: str, turn_on: bool) -> SmartPlugResult:
        entity_id = self.entity_map.get(device_id)
        if not entity_id:
            return SmartPlugResult(
                success=False,
                message=f"No Home Assistant entity mapped for device '{device_id}'.",
            )

        service = "turn_on" if turn_on else "turn_off"
        url = f"{self.base_url}/api/services/switch/{service}"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
        try:
            response = httpx.post(
                url,
                headers=headers,
                json={"entity_id": entity_id},
                timeout=self.REQUEST_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            return SmartPlugResult(
                success=False,
                message=f"Home Assistant request failed for {entity_id}: {exc}.",
            )

        if response.status_code >= 400:
            return SmartPlugResult(
                success=False,
                message=(
                    f"Home Assistant returned {response.status_code} for {entity_id}: "
                    f"{response.text[:200]}"
                ),
            )

        state = "on" if turn_on else "off"
        return SmartPlugResult(
            success=True,
            message=f"Home Assistant switched {entity_id} -> {state}.",
        )


class OptionalRealSmartPlugService(SmartPlugService):
    """Vendor-SDK stub kept for future non-Matter integrations."""

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


def _load_ha_entity_map() -> dict[str, str]:
    """Read HA_ENTITY_ID_<DEVICE_ID> env vars into a device_id -> entity_id map."""
    prefix = "HA_ENTITY_ID_"
    mapping: dict[str, str] = {}
    for key, value in os.environ.items():
        if key.startswith(prefix) and value:
            device_id = key[len(prefix):].lower()
            mapping[device_id] = value
    return mapping


def _load_shortcut_map() -> dict[str, tuple[str, str]]:
    """Pair up APPLE_SHORTCUT_<DEVICE>_ON / _OFF env vars per device."""
    on_prefix = "APPLE_SHORTCUT_"
    on_suffix = "_ON"
    off_suffix = "_OFF"
    pairs: dict[str, tuple[str, str]] = {}
    for key, value in os.environ.items():
        if not key.startswith(on_prefix) or not value:
            continue
        if key.endswith(on_suffix):
            device_id = key[len(on_prefix):-len(on_suffix)].lower()
            off_name = os.environ.get(f"{on_prefix}{device_id.upper()}{off_suffix}", "").strip()
            if off_name:
                pairs[device_id] = (value.strip(), off_name)
    return pairs


def build_smart_plug_service() -> SmartPlugService:
    enabled = os.getenv("REAL_SMART_PLUG_ENABLED", "false").lower() == "true"

    if enabled:
        shortcut_map = _load_shortcut_map()
        if shortcut_map:
            return AppleShortcutsSmartPlugService(shortcut_map)

        ha_base_url = os.getenv("HA_BASE_URL", "").strip()
        ha_token = os.getenv("HA_TOKEN", "").strip()
        if ha_base_url and ha_token:
            entity_map = _load_ha_entity_map()
            if entity_map:
                return HomeAssistantSmartPlugService(ha_base_url, ha_token, entity_map)

    real_service = OptionalRealSmartPlugService()
    if real_service.enabled and real_service.api_key:
        return real_service
    return MockSmartPlugService()
