from app.core.agent import EnergyAgent
from app.core.state import build_home_state
from app.services.smart_plug import MockSmartPlugService


class UnderPlanningStub:
    def is_enabled(self) -> bool:
        return True

    def plan(self, **_: object) -> dict[str, object]:
        return {
            "mode": "away_mode",
            "duration_hours": 3,
            "preserve_security": True,
            "preserve_comfort": False,
            "cost_sensitive": False,
            "prioritize_sleep": False,
            "interpreted_goal": "User is away and wants to lower usage.",
            "assumptions": ["Home telemetry is recent."],
            "constraints_applied": ["Essential devices remain powered."],
            "reasoning_summary": "The planner selected a minimal plan.",
            "selected_action_ids": ["action_living_room_lamp_off"],
            "action_rationales": [
                {
                    "action_id": "action_living_room_lamp_off",
                    "title": "Turn off Living Room Lamp",
                    "description": "Power down the living room lamp.",
                    "reason": "It is not needed while away.",
                }
            ],
            "skipped_actions": [
                {
                    "device_id": "kitchen_fridge",
                    "title": "Leave Kitchen Refrigerator on",
                    "reason": "Essential appliance cannot be turned off.",
                }
            ],
        }


def test_away_mode_keeps_fridge_on_and_pauses_ev() -> None:
    agent = EnergyAgent(MockSmartPlugService())
    state = build_home_state("away_mode")
    response = agent.plan_and_execute(state, "I'm leaving for 3 hours. Reduce energy use but keep the house secure.")

    assert response.watts_saved > 0
    assert any(action.device_id == "garage_ev_charger" for action in response.selected_plan)
    assert any(skip.device_id == "kitchen_fridge" for skip in response.skipped_actions)


def test_openai_underplanning_recovers_missing_energy_actions() -> None:
    agent = EnergyAgent(MockSmartPlugService(), openai_planner=UnderPlanningStub())
    state = build_home_state("away_mode")
    response = agent.plan_and_execute(state, "I'm leaving for 3 hours. Reduce energy use but keep the house secure.")

    action_ids = {action.device_id for action in response.selected_plan}

    assert response.agent_source == "openai"
    assert "garage_ev_charger" in action_ids
    assert "office_demo_plug_lamp" in action_ids
    assert "living_room_tv" in action_ids


def test_working_in_office_preserves_office_devices() -> None:
    agent = EnergyAgent(MockSmartPlugService())
    state = build_home_state("away_mode")
    response = agent.plan_and_execute(
        state,
        "I'll be working in the office and turn off the rest of the unnecessary lights.",
    )

    action_ids = {action.device_id for action in response.selected_plan}
    skipped_ids = {skip.device_id for skip in response.skipped_actions}

    assert "office_demo_plug_lamp" not in action_ids
    assert "office_monitor" not in action_ids
    assert "office_demo_plug_lamp" in skipped_ids
    assert "office_monitor" in skipped_ids
    assert "living_room_lamp" in action_ids
    assert "kitchen_ceiling_light" in action_ids


def test_lights_only_prompt_does_not_turn_off_unrelated_devices() -> None:
    agent = EnergyAgent(MockSmartPlugService())
    state = build_home_state("away_mode")
    response = agent.plan_and_execute(state, "Turn off unnecessary lights except the office.")

    action_ids = {action.device_id for action in response.selected_plan}
    skipped_ids = {skip.device_id for skip in response.skipped_actions}

    assert response.parsed_intent.action_scope == ["light", "smart_plug"]
    assert response.parsed_intent.protected_rooms == ["office"]
    assert "living_room_tv" not in action_ids
    assert "garage_ev_charger" not in action_ids
    assert "bedroom_fan" not in action_ids
    assert "office_demo_plug_lamp" not in action_ids
    assert "office_demo_plug_lamp" in skipped_ids
