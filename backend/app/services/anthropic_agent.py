from __future__ import annotations

import json
from typing import Any

from anthropic import APIConnectionError, APIError, APITimeoutError, Anthropic, RateLimitError

from app.core.settings import settings
from app.models.schemas import GoalIntent, HomeState, PlanAction, SkippedAction


class AnthropicPlanningError(Exception):
    pass


def _planning_schema() -> dict[str, Any]:
    return {
        "type": "json_schema",
        "name": "greenify_agent_plan",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": ["away_mode", "peak_pricing", "sleep_mode", "custom"],
                },
                "duration_hours": {"type": ["number", "null"]},
                "activity": {
                    "type": "string",
                    "enum": ["working", "cooking", "relaxing", "sleeping", "general"],
                },
                "preserve_security": {"type": "boolean"},
                "preserve_comfort": {"type": "boolean"},
                "cost_sensitive": {"type": "boolean"},
                "prioritize_sleep": {"type": "boolean"},
                "protected_rooms": {"type": "array", "items": {"type": "string"}},
                "action_scope": {"type": "array", "items": {"type": "string"}},
                "interpreted_goal": {"type": "string"},
                "assumptions": {"type": "array", "items": {"type": "string"}},
                "constraints_applied": {"type": "array", "items": {"type": "string"}},
                "reasoning_summary": {"type": "string"},
                "selected_action_ids": {"type": "array", "items": {"type": "string"}},
                "action_rationales": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "action_id": {"type": "string"},
                            "title": {"type": "string"},
                            "description": {"type": "string"},
                            "reason": {"type": "string"},
                        },
                        "required": ["action_id", "title", "description", "reason"],
                    },
                },
                "skipped_actions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "device_id": {"type": "string"},
                            "title": {"type": "string"},
                            "reason": {"type": "string"},
                        },
                        "required": ["device_id", "title", "reason"],
                    },
                },
            },
            "required": [
                "mode",
                "duration_hours",
                "activity",
                "preserve_security",
                "preserve_comfort",
                "cost_sensitive",
                "prioritize_sleep",
                "protected_rooms",
                "action_scope",
                "interpreted_goal",
                "assumptions",
                "constraints_applied",
                "reasoning_summary",
                "selected_action_ids",
                "action_rationales",
                "skipped_actions",
            ],
        },
    }


class AnthropicPlanner:
    def __init__(self) -> None:
        self.enabled = bool(settings.anthropic_api_key)
        self.client = Anthropic(api_key=settings.anthropic_api_key) if self.enabled else None

    def is_enabled(self) -> bool:
        return self.enabled and self.client is not None

    def plan(
        self,
        *,
        goal: str,
        home_state: HomeState,
        candidates: list[PlanAction],
        skipped_actions: list[SkippedAction],
        default_intent: GoalIntent,
        hard_constraints: list[str],
    ) -> dict[str, Any]:
        if not self.client:
            raise AnthropicPlanningError("Anthropic client is not configured.")

        prompt = {
            "goal": goal,
            "default_intent": default_intent.model_dump(mode="json"),
            "home_state": {
                "occupancy": home_state.occupancy.value,
                "current_time": home_state.current_time,
                "return_time": home_state.return_time,
                "peak_pricing": home_state.peak_pricing,
                "outdoor_temp_f": home_state.outdoor_temp_f,
                "comfort_temp_range": home_state.comfort_temp_range.model_dump(),
                "mode_label": home_state.mode_label,
                "total_power_watts": home_state.total_power_watts,
                "devices": [
                    {
                        "id": device.id,
                        "name": device.name,
                        "room": device.room,
                        "type": device.type.value,
                        "state": device.state.model_dump(mode="json"),
                        "power_watts": device.power_watts,
                        "essential": device.essential,
                        "security_related": device.security_related,
                        "comfort_related": device.comfort_related,
                        "remote_controllable": device.remote_controllable,
                        "can_defer": device.can_defer,
                        "real_device": device.real_device,
                        "notes": device.notes,
                    }
                    for device in home_state.devices
                ],
            },
            "candidate_actions": [
                {
                    "id": action.id,
                    "device_id": action.device_id,
                    "title": action.title,
                    "description": action.description,
                    "reason": action.reason,
                    "estimated_savings_watts": action.estimated_savings_watts,
                    "action_type": action.action_type,
                    "target_state": action.target_state.model_dump(mode="json"),
                    "priority": action.priority,
                }
                for action in candidates
            ],
            "existing_skipped_actions": [action.model_dump(mode="json") for action in skipped_actions],
            "hard_constraints": hard_constraints,
        }

        instructions = (
            "You are Greenify's Claude planning model. "
            "Convert the user's energy goal into a realistic home automation plan. "
            "Only select action ids from candidate_actions. "
            "Never contradict hard_constraints. "
            "Preserve essential appliances and security devices when applicable. "
            "Keep comfort within the supplied bounds. "
            "Use whole-home HVAC when weather materially exceeds the comfort band, and reduce it only when the prompt clearly allows comfort tradeoffs. "
            "Return concise, human-readable reasoning for a hackathon demo. "
            "If uncertain, stay conservative."
        )

        try:
            response = self.client.messages.create(
                model=settings.anthropic_model,
                max_tokens=settings.anthropic_max_tokens,
                temperature=settings.anthropic_temperature,
                system=instructions,
                messages=[{"role": "user", "content": json.dumps(prompt)}],
            )
        except (APIConnectionError, APITimeoutError, RateLimitError, APIError) as exc:
            raise AnthropicPlanningError(str(exc)) from exc

        output_text = "\n".join(
            block.text for block in response.content if getattr(block, "type", None) == "text" and getattr(block, "text", "")
        ).strip()

        if not output_text:
            raise AnthropicPlanningError("Anthropic returned an empty planning response.")

        try:
            return json.loads(output_text)
        except json.JSONDecodeError as exc:
            raise AnthropicPlanningError("Anthropic returned invalid planning JSON.") from exc
