from app.core.agent import EnergyAgent
from app.core.state import build_home_state
from app.services.smart_plug import MockSmartPlugService


def test_away_mode_keeps_fridge_on_and_pauses_ev() -> None:
    agent = EnergyAgent(MockSmartPlugService())
    state = build_home_state("away_mode")
    response = agent.plan_and_execute(state, "I'm leaving for 3 hours. Reduce energy use but keep the house secure.")

    assert response.watts_saved > 0
    assert any(action.device_id == "garage_ev_charger" for action in response.selected_plan)
    assert any(skip.device_id == "kitchen_fridge" for skip in response.skipped_actions)
