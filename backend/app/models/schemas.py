from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class Occupancy(str, Enum):
    HOME = "home"
    AWAY = "away"
    ASLEEP = "asleep"


class DeviceType(str, Enum):
    LIGHT = "light"
    SCREEN = "screen"
    FAN = "fan"
    FRIDGE = "fridge"
    EV_CHARGER = "ev_charger"
    SMART_PLUG = "smart_plug"
    APPLIANCE = "appliance"


class GoalIntent(BaseModel):
    raw_goal: str
    mode: Literal["away_mode", "peak_pricing", "sleep_mode", "custom"]
    duration_hours: float | None = None
    activity: Literal["working", "cooking", "relaxing", "sleeping", "general"]
    preserve_security: bool = True
    preserve_comfort: bool = True
    cost_sensitive: bool = False
    prioritize_sleep: bool = False
    protected_rooms: list[str] = []
    action_scope: list[str] = []


class DeviceState(BaseModel):
    is_on: bool = True
    brightness: float | None = Field(default=None, ge=0, le=1)
    screen_on: bool | None = None
    rotation_rpm: int | None = Field(default=None, ge=0)
    charger_status: str | None = None
    scheduled: bool = False
    schedule_note: str | None = None


class Device(BaseModel):
    id: str
    name: str
    room: str
    type: DeviceType
    state: DeviceState
    power_watts: float = Field(ge=0)
    essential: bool = False
    security_related: bool = False
    comfort_related: bool = False
    remote_controllable: bool = True
    can_defer: bool = False
    real_device: bool = False
    notes: str = ""


class ComfortRange(BaseModel):
    min_f: int
    max_f: int


class HomeState(BaseModel):
    occupancy: Occupancy
    current_time: str
    return_time: str | None = None
    peak_pricing: bool = False
    outdoor_temp_f: int
    comfort_temp_range: ComfortRange
    mode_label: str
    devices: list[Device]
    total_power_watts: float = 0


class PlanAction(BaseModel):
    id: str
    device_id: str
    title: str
    description: str
    reason: str
    estimated_savings_watts: float
    action_type: str
    target_state: DeviceState
    priority: int


class SkippedAction(BaseModel):
    device_id: str
    title: str
    reason: str


class ExecutionResult(BaseModel):
    action_id: str
    device_id: str
    title: str
    status: Literal["executed", "skipped"]
    message: str
    resulting_power_watts: float


class HomeStateSnapshot(BaseModel):
    step: int
    label: str
    state: HomeState


class PlanAndExecuteRequest(BaseModel):
    goal: str


class ScenarioResetRequest(BaseModel):
    scenario_id: Literal["away_mode", "peak_pricing", "sleep_mode"] = "away_mode"


class AgentResponse(BaseModel):
    parsed_intent: GoalIntent
    interpreted_goal: str
    assumptions: list[str]
    constraints_applied: list[str]
    reasoning_summary: str
    skipped_actions: list[SkippedAction]
    selected_plan: list[PlanAction]
    execution_results: list[ExecutionResult]
    initial_state: HomeState
    final_state: HomeState
    snapshots: list[HomeStateSnapshot]
    watts_before: float
    watts_after: float
    watts_saved: float
    planner: Literal["llm", "rules"] = "rules"
    planner_notice: str | None = None


SUPPORTED_ACTION_TYPES = {
    "turn_off",
    "turn_on",
    "screen_off",
    "set_brightness",
    "set_fan_speed",
    "pause_charging",
    "resume_charging",
}
