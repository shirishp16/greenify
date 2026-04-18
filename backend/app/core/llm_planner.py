from __future__ import annotations

import json
import logging
import os
from typing import Literal

from pydantic import BaseModel, ValidationError

from app.models.schemas import DeviceState, HomeState, SUPPORTED_ACTION_TYPES

logger = logging.getLogger(__name__)


ActionType = Literal[
    "turn_off",
    "turn_on",
    "screen_off",
    "set_brightness",
    "set_fan_speed",
    "pause_charging",
    "resume_charging",
]


class LLMPlanAction(BaseModel):
    device_id: str
    action_type: ActionType
    target_state: DeviceState
    title: str
    description: str
    reason: str
    estimated_savings_watts: float
    priority: int = 1


class LLMSkipped(BaseModel):
    device_id: str
    title: str
    reason: str


class LLMPlan(BaseModel):
    interpreted_goal: str
    reasoning_summary: str
    assumptions: list[str]
    constraints_applied: list[str]
    plan: list[LLMPlanAction]
    skipped: list[LLMSkipped] = []


SYSTEM_PROMPT = """You are Greenify, the planning brain of a smart-home energy agent.
You receive (a) the current home state and (b) a user goal in natural language.
You must output a JSON plan that the execution layer will apply directly to device state.

RESPONSE FORMAT
---------------
Return ONLY a single JSON object. No prose before or after. Schema:
{
  "interpreted_goal": string,
  "reasoning_summary": string,
  "assumptions": string[],
  "constraints_applied": string[],
  "plan": [
    {
      "device_id": string,            // must match a device in HOME STATE exactly
      "action_type": string,          // one of the allowed values below
      "target_state": {               // full post-change state, all 7 fields
        "is_on": boolean,
        "brightness": number | null,  // 0.0 - 1.0 or null
        "screen_on": boolean | null,
        "rotation_rpm": number | null, // integer, >= 0
        "charger_status": string | null, // "charging" | "paused" | null
        "scheduled": boolean,
        "schedule_note": string | null
      },
      "title": string,
      "description": string,
      "reason": string,
      "estimated_savings_watts": number, // positive = watts reduced, negative = extra draw
      "priority": number               // 1 (highest) .. 9 — execution order
    }
  ],
  "skipped": [{ "device_id": string, "title": string, "reason": string }]
}

ALLOWED action_type VALUES (closed set — anything else will be rejected)
-----------------------------------------------------------------------
- "turn_off"          — applies to light | screen | fan | smart_plug | ev_charger.
                         Also applies to hvac with target_state MUST have is_on=false.
                         target_state MUST have is_on=false.
                         For lights/plugs also set brightness=0.
                         For screens also set screen_on=false.
                         For fans also set rotation_rpm=0.
                         For EV chargers use "pause_charging" instead.
- "turn_on"           — applies to light | screen | fan | smart_plug | appliance.
                         Also applies to hvac with target_state MUST have is_on=true.
                         target_state MUST have is_on=true.
                         For lights/plugs set brightness in (0.0, 1.0]. For security lights in away mode prefer >= 0.8.
                         For screens set screen_on=true.
                         For fans set rotation_rpm > 0.
                         For appliance devices (washer, dryer, dishwasher): no brightness/rpm/screen_on needed.
                           Set brightness=null, screen_on=null, rotation_rpm=null, charger_status=null.
- "screen_off"        — applies to screen only.
                         target_state: is_on=false, screen_on=false.
- "set_brightness"    — applies to light | smart_plug only. Use for dimming that keeps the device ON.
                         target_state: is_on=true, brightness in (0.0, 1.0].
                         Use for sleep-mode dimming, peak-pricing partial reductions, etc.
- "set_fan_speed"     — applies to fan only. Use for arbitrary rpm changes.
                         target_state: rotation_rpm >= 0.
                         If rotation_rpm == 0, also set is_on=false. Otherwise is_on=true.
                         Keep rpm within comfort bounds (typically 60..240).
- "pause_charging"    — applies to ev_charger only.
                         target_state: is_on=false, charger_status="paused", scheduled=true,
                         schedule_note="Resume after optimization window.".
- "resume_charging"   — applies to ev_charger only.
                         target_state: is_on=true, charger_status="charging", scheduled=false,
                         schedule_note=null.

HARD CONSTRAINTS (violations will be dropped by the execution layer)
--------------------------------------------------------------------
1. device_id MUST exist in HOME STATE. Case-sensitive exact match.
2. action_type MUST be in the allowed set above.
3. Devices with `essential: true` MUST NOT be turned off, paused, or dimmed to 0.
4. Devices with `remote_controllable: false` MUST NOT appear in `plan`.
5. `target_state` MUST include all 7 fields (use null where not applicable).
6. `brightness` MUST be between 0 and 1 inclusive, or null.

PLANNING GUIDANCE
-----------------
- Use the HOME STATE occupancy, current_time, peak_pricing, outdoor_temp_f, and comfort_temp_range to
  decide what's appropriate. Do not ignore them.
- Respect `security_related` devices intelligently: in `away` occupancy they are usually better ON (and brighter)
  than OFF — prefer "turn_on" with high brightness over skipping them.
- Respect `comfort_related` devices: prefer "set_brightness" / "set_fan_speed" reductions over hard off,
  when the resident is present. When the home is asleep or away, full off is acceptable.
- Treat `hvac` as a whole-home comfort system. When outdoor temperature is outside the comfort band, prefer it ON
  unless the prompt is explicitly cost-sensitive or the resident is away and comfort is not being preserved.
- For `hvac`, target_state fields brightness, screen_on, rotation_rpm, and charger_status must all be null.
  HVAC is pure on/off — never set a setpoint, brightness, rpm, or charger_status on it.
- Order `plan` by impact: highest-watt reductions first.
- Devices of type `appliance` (washer, dryer, dishwasher) use only `turn_on` and `turn_off`.
  They have no brightness, rotation_rpm, screen_on, or charger_status. All those fields must be null.
  They are all `can_defer=true` — good candidates for peak-pricing and away-mode deferral.
  The dryer (5000W) and dishwasher (1200W) are high-draw; the washer (500W) is moderate.
- `estimated_savings_watts` should reflect the instantaneous watts no longer drawn. For "turn_on" or brightness
  increases, this may be 0 or negative.
- `constraints_applied` must describe constraints that actually shaped THIS plan (no boilerplate).
- `reasoning_summary` is 1-3 sentences that explain the concrete tradeoffs you made for THIS home state and goal.
  Do not output generic text like "ranked flexible loads first" — be specific to the devices and context.

EXAMPLES OF target_state PER ACTION TYPE
----------------------------------------
turn_off a lamp:
  { "is_on": false, "brightness": 0, "screen_on": null, "rotation_rpm": null,
    "charger_status": null, "scheduled": false, "schedule_note": null }

turn_on a security porch light to full:
  { "is_on": true, "brightness": 0.95, "screen_on": null, "rotation_rpm": null,
    "charger_status": null, "scheduled": false, "schedule_note": null }

set_brightness on bedroom lamp for sleep:
  { "is_on": true, "brightness": 0.1, "screen_on": null, "rotation_rpm": null,
    "charger_status": null, "scheduled": false, "schedule_note": null }

set_fan_speed to low for sleep:
  { "is_on": true, "brightness": null, "screen_on": null, "rotation_rpm": 80,
    "charger_status": null, "scheduled": false, "schedule_note": null }

pause EV charging:
  { "is_on": false, "brightness": null, "screen_on": null, "rotation_rpm": null,
    "charger_status": "paused", "scheduled": true,
    "schedule_note": "Resume after optimization window." }

If the user asks for something impossible or unsafe, return an empty `plan` and explain in
`reasoning_summary` and/or `skipped`.
"""


def _is_configured() -> bool:
    return bool(os.getenv("OPENAI_API_KEY", "").strip())


def _build_user_prompt(home_state: HomeState, goal: str) -> str:
    devices_payload = [
        {
            "id": device.id,
            "name": device.name,
            "room": device.room,
            "type": device.type.value,
            "power_watts": device.power_watts,
            "essential": device.essential,
            "security_related": device.security_related,
            "comfort_related": device.comfort_related,
            "remote_controllable": device.remote_controllable,
            "can_defer": device.can_defer,
            "real_device": device.real_device,
            "notes": device.notes,
            "state": device.state.model_dump(),
        }
        for device in home_state.devices
    ]
    context = {
        "occupancy": home_state.occupancy.value,
        "current_time": home_state.current_time,
        "return_time": home_state.return_time,
        "peak_pricing": home_state.peak_pricing,
        "outdoor_temp_f": home_state.outdoor_temp_f,
        "comfort_temp_range": home_state.comfort_temp_range.model_dump(),
        "mode_label": home_state.mode_label,
        "total_power_watts": home_state.total_power_watts,
        "devices": devices_payload,
    }
    return (
        "USER GOAL:\n"
        f"{goal}\n\n"
        "HOME STATE (JSON):\n"
        f"{json.dumps(context, indent=2)}\n\n"
        "Return the JSON plan object now."
    )


def plan_with_llm(home_state: HomeState, goal: str) -> tuple[LLMPlan | None, str | None]:
    """Ask the LLM for a plan. Returns (plan, notice).

    `plan` is None when the LLM is unavailable or returned something unusable.
    `notice` is a short human-readable reason suitable for surfacing in the UI
    so the fallback path is honest about why it ran.
    """
    if not _is_configured():
        return None, "OPENAI_API_KEY not set — running emergency rules fallback."

    try:
        from openai import OpenAI
    except ImportError:
        logger.warning("openai package not installed; falling back to rules planner.")
        return None, "openai package not installed — running emergency rules fallback."

    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip() or "gpt-4o-mini"

    try:
        client = OpenAI()
        completion = client.chat.completions.create(
            model=model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": _build_user_prompt(home_state, goal)},
            ],
        )
    except Exception as exc:
        logger.warning("OpenAI call failed (%s); falling back to rules planner.", exc)
        return None, f"LLM call failed ({exc.__class__.__name__}) — running emergency rules fallback."

    raw = completion.choices[0].message.content or ""
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.warning("LLM returned non-JSON content: %s", exc)
        return None, "LLM response was not valid JSON — running emergency rules fallback."

    try:
        plan = LLMPlan.model_validate(payload)
    except ValidationError as exc:
        logger.warning("LLM plan failed schema validation: %s", exc)
        return None, "LLM plan did not match schema — running emergency rules fallback."

    for action in plan.plan:
        if action.action_type not in SUPPORTED_ACTION_TYPES:
            logger.warning("LLM produced unsupported action_type %s", action.action_type)
            return None, "LLM plan used unsupported action_type — running emergency rules fallback."

    return plan, None
