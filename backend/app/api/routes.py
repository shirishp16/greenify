from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core.agent import EnergyAgent
from app.core.state import build_home_state_from_goal, home_state_store
from app.models.schemas import AgentResponse, DeviceType, HomeState, PlanAndExecuteRequest
from app.services.smart_plug import build_smart_plug_service


router = APIRouter(prefix="/api")
agent = EnergyAgent(smart_plug_service=build_smart_plug_service())


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/home-state", response_model=HomeState)
def get_home_state() -> HomeState:
    return home_state_store.get_state()


def _overlay_real_device_state(scenario_state: HomeState, stored: HomeState) -> HomeState:
    """Trust the persistent store for any device flagged real_device — the
    scenario rebuild is seed-fresh and doesn't know the plug is currently off.
    """
    stored_by_id = {d.id: d for d in stored.devices}
    for device in scenario_state.devices:
        if device.real_device and device.id in stored_by_id:
            device.state = stored_by_id[device.id].state.model_copy(deep=True)
    return scenario_state


@router.post("/agent/plan-and-execute", response_model=AgentResponse)
def plan_and_execute(payload: PlanAndExecuteRequest) -> AgentResponse:
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
