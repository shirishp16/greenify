from __future__ import annotations

from copy import deepcopy

from app.models.schemas import ComfortRange, Device, DeviceState, DeviceType, HomeState, Occupancy


ROOMS = ["living room", "kitchen", "bedroom", "office", "garage", "laundry", "exterior"]


def compute_device_draw(device: Device) -> float:
    if device.type == DeviceType.FRIDGE:
        return device.power_watts

    if device.type == DeviceType.EV_CHARGER:
        return device.power_watts if device.state.charger_status == "charging" else 0

    if device.type == DeviceType.FAN:
        return device.power_watts if device.state.rotation_rpm and device.state.rotation_rpm > 0 else 0

    if device.type == DeviceType.SCREEN:
        return device.power_watts if device.state.screen_on else 0

    if device.state.is_on:
        if device.state.brightness is not None:
            return round(device.power_watts * max(device.state.brightness, 0.15), 2)
        return device.power_watts

    return 0


def with_total_power(home_state: HomeState) -> HomeState:
    cloned = home_state.model_copy(deep=True)
    cloned.total_power_watts = round(sum(compute_device_draw(device) for device in cloned.devices), 2)
    return cloned


def _base_devices() -> list[Device]:
    return [
        Device(
            id="living_room_lamp",
            name="Living Room Lamp",
            room="living room",
            type=DeviceType.LIGHT,
            state=DeviceState(is_on=True, brightness=1),
            power_watts=60,
            comfort_related=True,
            notes="Primary ambient light in the living room.",
        ),
        Device(
            id="living_room_tv",
            name="Living Room TV",
            room="living room",
            type=DeviceType.SCREEN,
            state=DeviceState(is_on=True, screen_on=True),
            power_watts=120,
            remote_controllable=True,
            notes="Entertainment screen with bright standby draw when active.",
        ),
        Device(
            id="kitchen_ceiling_light",
            name="Kitchen Ceiling Light",
            room="kitchen",
            type=DeviceType.LIGHT,
            state=DeviceState(is_on=True, brightness=0.9),
            power_watts=45,
        ),
        Device(
            id="kitchen_fridge",
            name="Kitchen Refrigerator",
            room="kitchen",
            type=DeviceType.FRIDGE,
            state=DeviceState(is_on=True),
            power_watts=180,
            essential=True,
            notes="Essential appliance that must remain powered.",
        ),
        Device(
            id="bedroom_lamp",
            name="Bedroom Lamp",
            room="bedroom",
            type=DeviceType.LIGHT,
            state=DeviceState(is_on=True, brightness=0.7),
            power_watts=35,
            comfort_related=True,
        ),
        Device(
            id="bedroom_fan",
            name="Bedroom Fan",
            room="bedroom",
            type=DeviceType.FAN,
            state=DeviceState(is_on=True, rotation_rpm=180),
            power_watts=70,
            comfort_related=True,
        ),
        Device(
            id="central_hvac",
            name="Central HVAC",
            room="system",
            type=DeviceType.HVAC,
            state=DeviceState(is_on=False),
            power_watts=3500,
            comfort_related=True,
            notes="Whole-home heating and cooling system tied to the outdoor temperature and comfort band.",
        ),
        Device(
            id="office_monitor",
            name="Office Monitor",
            room="office",
            type=DeviceType.SCREEN,
            state=DeviceState(is_on=True, screen_on=True),
            power_watts=95,
        ),
        Device(
            id="office_demo_plug_lamp",
            name="Demo Smart Plug Lamp",
            room="office",
            type=DeviceType.SMART_PLUG,
            state=DeviceState(is_on=True, brightness=1),
            power_watts=50,
            real_device=True,
            notes="Mapped to the smart plug service abstraction for demo proof.",
        ),
        Device(
            id="garage_ev_charger",
            name="EV Charger",
            room="garage",
            type=DeviceType.EV_CHARGER,
            state=DeviceState(is_on=True, charger_status="charging"),
            power_watts=7200,
            can_defer=True,
            notes="Can be paused or deferred during away mode or peak pricing windows.",
        ),
        Device(
            id="porch_light",
            name="Porch Light",
            room="exterior",
            type=DeviceType.LIGHT,
            state=DeviceState(is_on=True, brightness=0.6),
            power_watts=18,
            security_related=True,
            notes="Preserved when the home is away for visibility and security.",
        ),
        Device(
            id="kitchen_dishwasher",
            name="Dishwasher",
            room="kitchen",
            type=DeviceType.APPLIANCE,
            state=DeviceState(is_on=False),
            power_watts=1200,
            can_defer=True,
            notes="High-draw appliance that runs on a schedule. Safe to defer during peak pricing or away mode.",
        ),
        Device(
            id="laundry_washer",
            name="Washing Machine",
            room="laundry",
            type=DeviceType.APPLIANCE,
            state=DeviceState(is_on=True),
            power_watts=500,
            can_defer=True,
            notes="Can be paused mid-cycle and resumed later. Good candidate for off-peak scheduling.",
        ),
        Device(
            id="laundry_dryer",
            name="Dryer",
            room="laundry",
            type=DeviceType.APPLIANCE,
            state=DeviceState(is_on=False),
            power_watts=5000,
            can_defer=True,
            notes="High-draw appliance. Ideal to defer to off-peak hours; typically runs after washer completes.",
        ),
    ]


def build_home_state(scenario_id: str) -> HomeState:
    devices = _base_devices()
    if scenario_id == "away_mode":
        state = HomeState(
            occupancy=Occupancy.AWAY,
            current_time="2026-04-17T18:00:00",
            return_time="2026-04-17T21:00:00",
            peak_pricing=False,
            outdoor_temp_f=72,
            comfort_temp_range=ComfortRange(min_f=67, max_f=75),
            mode_label="Prompt Driven",
            devices=devices,
        )
    elif scenario_id == "peak_pricing":
        state = HomeState(
            occupancy=Occupancy.HOME,
            current_time="2026-04-17T17:30:00",
            return_time=None,
            peak_pricing=True,
            outdoor_temp_f=83,
            comfort_temp_range=ComfortRange(min_f=68, max_f=76),
            mode_label="Prompt Driven",
            devices=devices,
        )
        for device in state.devices:
            if device.id == "central_hvac":
                device.state.is_on = True
    elif scenario_id == "sleep_mode":
        state = HomeState(
            occupancy=Occupancy.HOME,
            current_time="2026-04-17T22:30:00",
            return_time=None,
            peak_pricing=False,
            outdoor_temp_f=66,
            comfort_temp_range=ComfortRange(min_f=65, max_f=73),
            mode_label="Prompt Driven",
            devices=devices,
        )
        for device in state.devices:
            if device.id == "bedroom_lamp":
                device.state.brightness = 0.45
            if device.id == "bedroom_fan":
                device.state.rotation_rpm = 120
            if device.id == "living_room_tv":
                device.state.screen_on = True
    else:
        state = HomeState(
            occupancy=Occupancy.HOME,
            current_time="2026-04-17T15:00:00",
            return_time=None,
            peak_pricing=False,
            outdoor_temp_f=74,
            comfort_temp_range=ComfortRange(min_f=67, max_f=75),
            mode_label="Prompt Driven",
            devices=devices,
        )

    return with_total_power(state)


def build_home_state_from_goal(goal: str) -> HomeState:
    normalized = goal.lower().strip()

    if "sleep" in normalized:
        return build_home_state("sleep_mode")
    if "peak" in normalized or "bill" in normalized:
        return build_home_state("peak_pricing")
    if any(marker in normalized for marker in ["away", "leaving", "not home", "out of the house"]):
        return build_home_state("away_mode")

    return build_home_state("custom")


class HomeStateStore:
    def __init__(self) -> None:
        self._state = build_home_state("custom")

    def get_state(self) -> HomeState:
        return deepcopy(self._state)

    def set_state(self, state: HomeState) -> HomeState:
        self._state = with_total_power(state)
        return self.get_state()


home_state_store = HomeStateStore()
