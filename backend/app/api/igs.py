from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.routes import _overlay_real_device_state, agent
from app.core.state import build_home_state_from_goal, compute_device_draw, home_state_store
from app.models.schemas import (
    AgentResponse,
    Device,
    DeviceType,
    HomeState,
    PlanAndExecuteRequest,
)


router = APIRouter(prefix="/igs", tags=["igs"])


FLEXIBLE_TYPES = {
    DeviceType.HVAC,
    DeviceType.EV_CHARGER,
    DeviceType.SMART_PLUG,
    DeviceType.LIGHT,
    DeviceType.APPLIANCE,
    DeviceType.FAN,
}

CURTAILMENT_ACTIONS = {
    "turn_off",
    "screen_off",
    "pause_charging",
    "set_brightness",
    "set_fan_speed",
}

EVENT_GOAL_MAP: dict[str, str] = {
    "peak_start": "Peak pricing is active — reduce load while preserving comfort.",
    "demand_response": "Demand response event — curtail flexible loads as aggressively as safe.",
    "restore": "Grid event has ended — restore normal comfort operations.",
}


class IgsAsset(BaseModel):
    device_id: str
    type: str
    room: str
    nameplate_watts: float
    current_watts: float
    is_on: bool
    deferrable: bool
    comfort_critical: bool


class IgsHomeProfile(BaseModel):
    home_id: str
    as_of: str
    occupancy: str
    peak_pricing: bool
    outdoor_temp_f: int
    comfort_min_f: int
    comfort_max_f: int
    total_power_watts: float
    assets: list[IgsAsset]


class IgsCurtailedAction(BaseModel):
    device_id: str
    action_type: str
    estimated_savings_watts: float


class IgsPreservedAction(BaseModel):
    device_id: str
    reason: str


class IgsOptimizationResult(BaseModel):
    goal: str
    as_of: str
    planner: Literal["llm", "rules"]
    planner_notice: str | None
    watts_before: float
    watts_after: float
    watts_saved: float
    curtailed: list[IgsCurtailedAction]
    preserved: list[IgsPreservedAction]
    reasoning_summary: str


class IgsEventRequest(BaseModel):
    event_type: Literal["peak_start", "demand_response", "restore"]
    duration_minutes: int | None = None


class IgsEventResponse(BaseModel):
    event_type: str
    duration_minutes: int | None
    projected_curtailment_watts: float
    respondent_mode: str
    comfort_preserved: bool
    actions: list[IgsCurtailedAction]
    reasoning: str


def _device_to_asset(device: Device) -> IgsAsset:
    return IgsAsset(
        device_id=device.id,
        type=device.type.value,
        room=device.room,
        nameplate_watts=device.power_watts,
        current_watts=compute_device_draw(device),
        is_on=device.state.is_on,
        deferrable=device.can_defer,
        comfort_critical=device.comfort_related,
    )


def _select_flexible_assets(state: HomeState) -> list[IgsAsset]:
    return [
        _device_to_asset(device)
        for device in state.devices
        if device.type in FLEXIBLE_TYPES and not device.essential
    ]


def _curtailed_actions(response: AgentResponse) -> list[IgsCurtailedAction]:
    return [
        IgsCurtailedAction(
            device_id=action.device_id,
            action_type=action.action_type,
            estimated_savings_watts=action.estimated_savings_watts,
        )
        for action in response.selected_plan
        if action.action_type in CURTAILMENT_ACTIONS
    ]


@router.post("/home-profile", response_model=IgsHomeProfile)
def home_profile() -> IgsHomeProfile:
    state = home_state_store.get_state()
    return IgsHomeProfile(
        home_id="greenify-demo-001",
        as_of=state.current_time,
        occupancy=state.occupancy.value,
        peak_pricing=state.peak_pricing,
        outdoor_temp_f=state.outdoor_temp_f,
        comfort_min_f=state.comfort_temp_range.min_f,
        comfort_max_f=state.comfort_temp_range.max_f,
        total_power_watts=state.total_power_watts,
        assets=_select_flexible_assets(state),
    )


@router.post("/optimization-result", response_model=IgsOptimizationResult)
def optimization_result(payload: PlanAndExecuteRequest) -> IgsOptimizationResult:
    current_state = _overlay_real_device_state(
        build_home_state_from_goal(payload.goal),
        home_state_store.get_state(),
    )
    response = agent.plan_and_execute(
        current_state,
        payload.goal,
        chat_history=payload.chat_history,
    )
    home_state_store.set_state(response.final_state)

    return IgsOptimizationResult(
        goal=payload.goal,
        as_of=response.initial_state.current_time,
        planner=response.planner,
        planner_notice=response.planner_notice,
        watts_before=response.watts_before,
        watts_after=response.watts_after,
        watts_saved=response.watts_saved,
        curtailed=_curtailed_actions(response),
        preserved=[
            IgsPreservedAction(device_id=s.device_id, reason=s.reason)
            for s in response.skipped_actions
        ],
        reasoning_summary=response.reasoning_summary,
    )


@router.post("/event-response", response_model=IgsEventResponse)
def event_response(payload: IgsEventRequest) -> IgsEventResponse:
    goal = EVENT_GOAL_MAP[payload.event_type]
    current_state = _overlay_real_device_state(
        build_home_state_from_goal(goal),
        home_state_store.get_state(),
    )
    response = agent.plan_and_execute(current_state, goal, chat_history=None)
    home_state_store.set_state(response.final_state)

    return IgsEventResponse(
        event_type=payload.event_type,
        duration_minutes=payload.duration_minutes,
        projected_curtailment_watts=response.watts_saved,
        respondent_mode=response.parsed_intent.mode,
        comfort_preserved=response.parsed_intent.preserve_comfort,
        actions=_curtailed_actions(response),
        reasoning=response.reasoning_summary,
    )
