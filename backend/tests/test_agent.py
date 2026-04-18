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

    assert response.planner == "llm"
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


def test_hot_weather_keeps_hvac_running_for_comfort() -> None:
    agent = EnergyAgent(MockSmartPlugService())
    state = build_home_state("peak_pricing")
    response = agent.plan_and_execute(state, "Lower my bill, but keep the house comfortable.")

    action_ids = {action.device_id for action in response.selected_plan}
    hvac = next(device for device in response.final_state.devices if device.id == "central_hvac")

    assert "central_hvac" not in action_ids
    assert hvac.state.is_on is True


def test_away_goal_turns_off_hvac_when_weather_is_mild() -> None:
    agent = EnergyAgent(MockSmartPlugService())
    state = build_home_state("away_mode")
    hvac = next(device for device in state.devices if device.id == "central_hvac")
    hvac.state.is_on = True
    response = agent.plan_and_execute(state, "I'm leaving for 3 hours. Reduce energy use but keep the house secure.")

    hvac_actions = [action for action in response.selected_plan if action.device_id == "central_hvac"]

    assert hvac_actions
    assert hvac_actions[0].action_type == "turn_off"


def test_sleep_goal_does_not_treat_bedroom_fan_as_required() -> None:
    agent = EnergyAgent(MockSmartPlugService())
    state = build_home_state("sleep_mode")
    response = agent.plan_and_execute(state, "Prepare the house for sleep mode.")

    skipped_ids = {skip.device_id for skip in response.skipped_actions}
    preserved_titles = {skip.title for skip in response.skipped_actions}

    assert "bedroom_fan" not in skipped_ids
    assert "Preserve Bedroom Fan" not in preserved_titles
