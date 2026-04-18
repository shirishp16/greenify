from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core.agent import EnergyAgent
from app.core.state import build_home_state_from_goal, home_state_store
from app.models.schemas import AgentResponse, DeviceType, HomeState, PlanAndExecuteRequest
from app.services.openai_agent import OpenAIPlanner
from app.services.smart_plug import build_smart_plug_service


router = APIRouter(prefix="/api")
agent = EnergyAgent(smart_plug_service=build_smart_plug_service(), openai_planner=OpenAIPlanner())


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/home-state", response_model=HomeState)
def get_home_state() -> HomeState:
    return home_state_store.get_state()


@router.post("/agent/plan-and-execute", response_model=AgentResponse)
def plan_and_execute(payload: PlanAndExecuteRequest) -> AgentResponse:
    current_state = build_home_state_from_goal(payload.goal)
    response = agent.plan_and_execute(
        current_state,
        payload.goal,
        chat_history=payload.chat_history,
    )
    home_state_store.set_state(response.final_state)
    return response


@router.post("/device/{device_id}/toggle", response_model=HomeState)
def toggle_device(device_id: str) -> HomeState:
    state = home_state_store.get_state()
    device = next((d for d in state.devices if d.id == device_id), None)
    if device is None:
        raise HTTPException(status_code=404, detail=f"Unknown device id: {device_id}")

    new_is_on = not device.state.is_on
    if device.real_device:
        agent.smart_plug_service.set_power(device_id, new_is_on)

    device.state.is_on = new_is_on
    if device.type in {DeviceType.LIGHT, DeviceType.SMART_PLUG}:
        device.state.brightness = 1.0 if new_is_on else 0
    elif device.type == DeviceType.SCREEN:
        device.state.screen_on = new_is_on
    elif device.type == DeviceType.FAN:
        device.state.rotation_rpm = 120 if new_is_on else 0
    elif device.type == DeviceType.EV_CHARGER:
        device.state.charger_status = "charging" if new_is_on else "paused"

    return home_state_store.set_state(state)
