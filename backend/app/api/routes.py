from __future__ import annotations

from fastapi import APIRouter

from app.core.agent import EnergyAgent
from app.core.state import home_state_store
from app.models.schemas import AgentResponse, HomeState, PlanAndExecuteRequest, ScenarioResetRequest
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


@router.post("/scenario/reset", response_model=HomeState)
def reset_scenario(payload: ScenarioResetRequest) -> HomeState:
    return home_state_store.reset(payload.scenario_id)


@router.post("/agent/plan-and-execute", response_model=AgentResponse)
def plan_and_execute(payload: PlanAndExecuteRequest) -> AgentResponse:
    current_state = home_state_store.get_state()
    response = agent.plan_and_execute(current_state, payload.goal)
    home_state_store.set_state(response.final_state)
    return response
