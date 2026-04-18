from __future__ import annotations

import re
from copy import deepcopy

from app.core.llm_planner import LLMPlan, plan_with_llm
from app.core.state import compute_device_draw, with_total_power
from app.models.schemas import (
    AgentResponse,
    Device,
    DeviceState,
    DeviceType,
    ExecutionResult,
    GoalIntent,
    HomeState,
    HomeStateSnapshot,
    Occupancy,
    PlanAction,
    SkippedAction,
)
from app.services.openai_agent import OpenAIPlanner, OpenAIPlanningError
from app.services.smart_plug import SmartPlugService


class EnergyAgent:
    ROOM_ALIASES = {
        "office": ["office", "desk", "study"],
        "bedroom": ["bedroom"],
        "living room": ["living room", "livingroom", "lounge"],
        "kitchen": ["kitchen"],
        "garage": ["garage"],
    }

    def __init__(self, smart_plug_service: SmartPlugService, openai_planner: OpenAIPlanner | None = None) -> None:
        self.smart_plug_service = smart_plug_service
        self.openai_planner = openai_planner or OpenAIPlanner()

    def _goal_implies_room_presence(self, normalized_goal: str, aliases: list[str], activity: str) -> bool:
        presence_patterns = [
            "about to",
            "using",
            "need",
            "keep",
            "leave",
            "except",
            "but not",
            "working in",
            "working from",
            "focus in",
            "relaxing in",
            "watching in",
            "sleeping in",
            "cooking in",
            "i'll be in",
            "i will be in",
            "i'm in",
            "i am in",
        ]

        for alias in aliases:
            explicit_phrases = [
                f"about to work in the {alias}",
                f"about to work in {alias}",
                f"work in the {alias}",
                f"work in {alias}",
                f"working in the {alias}",
                f"working in {alias}",
                f"working from the {alias}",
                f"working from {alias}",
                f"focus in the {alias}",
                f"focus in {alias}",
                f"using the {alias}",
                f"using {alias}",
                f"i'll be in the {alias}",
                f"i'll be in {alias}",
                f"i will be in the {alias}",
                f"i will be in {alias}",
                f"i'm in the {alias}",
                f"i'm in {alias}",
                f"i am in the {alias}",
                f"i am in {alias}",
                f"relaxing in the {alias}",
                f"relaxing in {alias}",
                f"watching in the {alias}",
                f"watching in {alias}",
                f"sleeping in the {alias}",
                f"sleeping in {alias}",
                f"cooking in the {alias}",
                f"cooking in {alias}",
                f"need the {alias}",
                f"need {alias}",
                f"keep the {alias} on",
                f"keep {alias} on",
                f"leave the {alias} on",
                f"leave {alias} on",
                f"except the {alias}",
                f"except {alias}",
                f"but not the {alias}",
                f"but not {alias}",
                f"preserve the {alias}",
                f"preserve {alias}",
            ]
            if any(phrase in normalized_goal for phrase in explicit_phrases):
                return True
            if any(f"{pattern} the {alias}" in normalized_goal for pattern in presence_patterns):
                return True
            if any(f"{pattern} {alias}" in normalized_goal for pattern in presence_patterns):
                return True

        return False

    def _extract_protected_rooms(self, normalized_goal: str, activity: str) -> list[str]:
        protected_rooms: list[str] = []
        for room, aliases in self.ROOM_ALIASES.items():
            if self._goal_implies_room_presence(normalized_goal, aliases, activity):
                protected_rooms.append(room)

        return list(dict.fromkeys(protected_rooms))

    def _extract_action_scope(self, normalized_goal: str) -> list[str]:
        broad_energy_markers = [
            "reduce energy",
            "lower energy",
            "save energy",
            "power usage",
            "energy usage",
            "lower my bill",
            "peak",
            "everything",
            "whole house",
            "entire house",
            "all devices",
            "electronics and lights",
        ]

        scope: list[str] = []
        if "light" in normalized_goal or "lamp" in normalized_goal:
            scope.extend(["light", "smart_plug"])
        if any(marker in normalized_goal for marker in ["screen", "monitor", "tv", "display", "electronics"]):
            scope.append("screen")
        if "fan" in normalized_goal:
            scope.append("fan")
        if any(marker in normalized_goal for marker in ["hvac", "ac", "a/c", "air conditioning", "heat", "heating", "cooling", "thermostat"]):
            scope.append("hvac")
        if any(marker in normalized_goal for marker in ["ev", "charger", "charging"]):
            scope.append("ev_charger")

        if any(marker in normalized_goal for marker in broad_energy_markers):
            return []

        return list(dict.fromkeys(scope))

    def _infer_activity(self, normalized_goal: str) -> str:
        if any(marker in normalized_goal for marker in ["working", "work", "focus", "desk work", "meeting", "coding"]):
            return "working"
        if any(marker in normalized_goal for marker in ["cook", "cooking", "prep dinner", "making food"]):
            return "cooking"
        if any(marker in normalized_goal for marker in ["sleep", "bedtime", "asleep"]):
            return "sleeping"
        if any(marker in normalized_goal for marker in ["watch", "movie", "tv", "relax", "reading"]):
            return "relaxing"
        return "general"

    def _device_needed_for_activity(self, intent: GoalIntent, room: str, device_type: DeviceType) -> bool:
        if room not in intent.protected_rooms:
            return False

        if intent.activity == "working" and room == "office":
            return device_type in {DeviceType.SCREEN, DeviceType.SMART_PLUG, DeviceType.LIGHT}
        if intent.activity == "cooking" and room == "kitchen":
            return device_type in {DeviceType.LIGHT, DeviceType.FRIDGE, DeviceType.SMART_PLUG}
        if intent.activity == "relaxing" and room == "living room":
            return device_type in {DeviceType.SCREEN, DeviceType.LIGHT}
        if intent.activity == "sleeping" and room == "bedroom":
            return device_type == DeviceType.LIGHT
        if intent.activity == "general":
            return device_type in {DeviceType.LIGHT, DeviceType.SCREEN, DeviceType.SMART_PLUG, DeviceType.FAN}

        return False

    def _device_should_be_reduced_outside_active_room(self, device: Device, intent: GoalIntent) -> bool:
        if not intent.protected_rooms:
            return False
        if device.room in intent.protected_rooms:
            return False
        return device.type in {DeviceType.LIGHT, DeviceType.SCREEN, DeviceType.FAN, DeviceType.SMART_PLUG}

    def _hvac_needs_climate_support(self, home_state: HomeState) -> bool:
        return (
            home_state.outdoor_temp_f > home_state.comfort_temp_range.max_f + 2
            or home_state.outdoor_temp_f < home_state.comfort_temp_range.min_f - 2
        )

    def _hvac_is_extreme_weather(self, home_state: HomeState) -> bool:
        return (
            home_state.outdoor_temp_f > home_state.comfort_temp_range.max_f + 8
            or home_state.outdoor_temp_f < home_state.comfort_temp_range.min_f - 8
        )

    def _desired_hvac_state(self, device: Device, intent: GoalIntent, home_state: HomeState) -> DeviceState | None:
        target = device.state.model_copy(deep=True)
        needs_climate_support = self._hvac_needs_climate_support(home_state)
        extreme_weather = self._hvac_is_extreme_weather(home_state)

        if not needs_climate_support:
            target.is_on = False
            return target if device.state.is_on else None

        if intent.mode == "away_mode" and not intent.preserve_comfort and not extreme_weather:
            target.is_on = False
            return target if device.state.is_on else None

        if intent.preserve_comfort or intent.protected_rooms or home_state.occupancy == Occupancy.HOME or extreme_weather:
            target.is_on = True
            target.scheduled = False
            target.schedule_note = None
            return target if not device.state.is_on else None

        if intent.cost_sensitive and not intent.protected_rooms and not extreme_weather:
            target.is_on = False
            return target if device.state.is_on else None

        return None

    def _default_brightness_for_activity(self, intent: GoalIntent, room: str) -> float:
        if intent.activity == "working" and room == "office":
            return 0.95
        if intent.activity == "cooking" and room == "kitchen":
            return 1.0
        if intent.activity == "relaxing" and room == "living room":
            return 0.65
        if intent.activity == "sleeping" and room == "bedroom":
            return 0.3
        return 0.8

    def _desired_state_for_device(self, device: Device, intent: GoalIntent, home_state: HomeState) -> DeviceState | None:
        target = device.state.model_copy(deep=True)
        protected = device.room in intent.protected_rooms
        needed_for_activity = self._device_needed_for_activity(intent, device.room, device.type)

        if device.essential:
            target.is_on = True
            return target

        if device.type == DeviceType.HVAC:
            return self._desired_hvac_state(device, intent, home_state)

        if device.security_related and intent.preserve_security:
            target.is_on = True
            target.scheduled = True
            target.schedule_note = "Keep active while away for visibility."
            if target.brightness is not None and target.brightness <= 0:
                target.brightness = 0.6
            return target

        if device.type == DeviceType.FRIDGE:
            target.is_on = True
            return target

        if device.type == DeviceType.EV_CHARGER:
            if intent.mode == "away_mode" or intent.cost_sensitive or intent.protected_rooms:
                target.is_on = False
                target.charger_status = "paused"
                target.scheduled = True
                target.schedule_note = "Resume after the active optimization window."
                return target
            return None

        if needed_for_activity:
            target.is_on = True
            target.scheduled = False
            target.schedule_note = None
            if device.type in {DeviceType.LIGHT, DeviceType.SMART_PLUG}:
                target.brightness = self._default_brightness_for_activity(intent, device.room)
            if device.type == DeviceType.SCREEN:
                target.screen_on = True
            if device.type == DeviceType.FAN:
                target.rotation_rpm = 90 if intent.activity == "sleeping" else 120
            return target

        if protected:
            return None

        if self._device_should_be_reduced_outside_active_room(device, intent) or intent.mode == "away_mode":
            target.scheduled = False
            target.schedule_note = None
            if device.type in {DeviceType.LIGHT, DeviceType.SMART_PLUG}:
                target.is_on = False
                target.brightness = 0
            elif device.type == DeviceType.SCREEN:
                target.is_on = False
                target.screen_on = False
            elif device.type == DeviceType.FAN:
                target.is_on = False
                target.rotation_rpm = 0
            return target

        return None

    def _state_matches_target(self, device: Device, target: DeviceState) -> bool:
        if device.type in {DeviceType.LIGHT, DeviceType.SMART_PLUG}:
            current_brightness = device.state.brightness if device.state.brightness is not None else 0
            target_brightness = target.brightness if target.brightness is not None else 0
            return device.state.is_on == target.is_on and abs(current_brightness - target_brightness) < 0.05
        if device.type == DeviceType.SCREEN:
            return bool(device.state.screen_on) == bool(target.screen_on)
        if device.type == DeviceType.FAN:
            current_rpm = device.state.rotation_rpm or 0
            target_rpm = target.rotation_rpm or 0
            return device.state.is_on == target.is_on and current_rpm == target_rpm
        if device.type == DeviceType.EV_CHARGER:
            return device.state.charger_status == target.charger_status
        return device.state.is_on == target.is_on

    def parse_goal(self, goal: str, home_state: HomeState) -> GoalIntent:
        normalized = goal.lower().strip()
        duration_match = re.search(r"(\d+(?:\.\d+)?)\s*hour", normalized)
        duration_hours = float(duration_match.group(1)) if duration_match else None
        activity = self._infer_activity(normalized)
        protected_rooms = self._extract_protected_rooms(normalized, activity)
        action_scope = self._extract_action_scope(normalized)
        office_working = "work" in normalized and "office" in normalized
        explicit_security_request = "secure" in normalized or "security" in normalized
        implied_away_request = any(marker in normalized for marker in ["away", "leaving", "not home", "out of the house"])

        if "sleep" in normalized:
            mode = "sleep_mode"
        elif "peak" in normalized or "bill" in normalized:
            mode = "peak_pricing"
        elif "away" in normalized or "leaving" in normalized:
            mode = "away_mode"
        else:
            mode = "custom"

        return GoalIntent(
            raw_goal=goal,
            mode=mode,
            duration_hours=duration_hours,
            activity=activity,
            preserve_security=explicit_security_request or (implied_away_request and not protected_rooms and not office_working),
            preserve_comfort=(
                "comfortable" in normalized
                or "comfort" in normalized
                or home_state.occupancy == Occupancy.HOME
                or bool(protected_rooms)
                or office_working
            ),
            cost_sensitive="bill" in normalized or home_state.peak_pricing,
            prioritize_sleep="sleep" in normalized,
            protected_rooms=protected_rooms,
            action_scope=action_scope,
        )

    def _action_metadata(self, device: Device, intent: GoalIntent, target: DeviceState) -> tuple[str, str, str, int]:
        outside_active_room = bool(intent.protected_rooms) and device.room not in intent.protected_rooms
        needed_for_activity = self._device_needed_for_activity(intent, device.room, device.type)

        if device.type == DeviceType.EV_CHARGER:
            return (
                "pause_charging",
                "Pause EV charging",
                "Defer EV charging until the optimization window ends.",
                "Flexible high-load device is the largest savings opportunity.",
                0,
            )

        if device.type in {DeviceType.LIGHT, DeviceType.SMART_PLUG}:
            if target.is_on:
                return (
                    "turn_on",
                    f"Turn on {device.name}",
                    f"Bring {device.name} online in the {device.room} for the current activity.",
                    f"{device.name} should be available while the user is {intent.activity} in the {device.room}.",
                    0,
                )
            if outside_active_room:
                return (
                    "turn_off",
                    f"Turn off {device.name}",
                    f"Power down {device.name} in the {device.room} so the home optimizes around the occupied room.",
                    "This device is outside the active room and is a strong shutdown candidate.",
                    0,
                )
            return (
                "turn_off",
                f"Turn off {device.name}",
                f"Power down {device.name} in the {device.room}.",
                "Lighting can be reduced without affecting safety in this scenario.",
                1,
            )

        if device.type == DeviceType.SCREEN:
            if target.screen_on:
                return (
                    "screen_on",
                    f"Turn on {device.name}",
                    f"Wake {device.name} in the {device.room} for the current activity.",
                    f"{device.name} should be available while the user is {intent.activity} in the {device.room}.",
                    0,
                )
            if outside_active_room:
                return (
                    "screen_off",
                    f"Turn off {device.name}",
                    f"Shut down {device.name} in the {device.room} to focus energy use on the occupied room.",
                    "This display is outside the active room and should be shut down first.",
                    1,
                )
            return (
                "screen_off",
                f"Turn off {device.name}",
                f"Shut down {device.name} to eliminate standby use.",
                "Unused displays are high-value discretionary loads.",
                2,
            )

        if device.type == DeviceType.FAN:
            target_rpm = target.rotation_rpm or 0
            current_rpm = device.state.rotation_rpm or 0
            if target_rpm > 0 and current_rpm == 0:
                return (
                    "fan_on",
                    f"Turn on {device.name}",
                    f"Start {device.name} in the {device.room} for the current activity.",
                    f"{device.name} supports comfort while the user is {intent.activity} in the {device.room}.",
                    1,
                )
            if target_rpm > 0 and target_rpm != current_rpm:
                return (
                    "fan_slow",
                    f"Adjust {device.name}",
                    f"Set {device.name} to a lower comfort speed in the {device.room}.",
                    "Match the fan speed to the current room activity while using less power.",
                    2,
                )
            if outside_active_room:
                return (
                    "fan_off",
                    f"Turn off {device.name}",
                    f"Stop {device.name} in the {device.room} while the user is active elsewhere.",
                    "This fan is outside the active room and can be stopped to reduce waste.",
                    2,
                )
            return (
                "fan_off",
                f"Turn off {device.name}",
                f"Stop {device.name} while the room is unoccupied.",
                "Fan can be safely stopped in this scenario.",
                4,
            )

        if device.type == DeviceType.HVAC:
            if target.is_on:
                return (
                    "turn_on",
                    "Run Central HVAC",
                    "Keep the whole-home HVAC system running to stay within the comfort band.",
                    "Outdoor temperature is outside the comfort band, so climate control remains worthwhile.",
                    1,
                )
            return (
                "turn_off",
                "Pause Central HVAC",
                "Turn off the whole-home HVAC system to reduce heavy comfort-system draw.",
                "Outdoor conditions and prompt constraints allow the HVAC load to be reduced safely.",
                1,
            )

        return (
            "preserve",
            f"Preserve {device.name}",
            f"Leave {device.name} unchanged.",
            "Current device state already supports the goal.",
            5,
        )

    def _build_action(self, device: Device, intent: GoalIntent, target: DeviceState) -> PlanAction:
        action_type, title, description, reason, priority = self._action_metadata(device, intent, target)
        current_draw = compute_device_draw(device)
        future_device = device.model_copy(deep=True)
        future_device.state = target.model_copy(deep=True)
        future_draw = compute_device_draw(future_device)
        estimated_savings_watts = round(max(current_draw - future_draw, 0), 2)

        return PlanAction(
            id=f"action_{device.id}_{action_type}",
            device_id=device.id,
            title=title,
            description=description,
            reason=reason,
            estimated_savings_watts=estimated_savings_watts,
            action_type=action_type,
            target_state=target,
            priority=priority,
        )

    def _action_targets_protected_room(self, action: PlanAction, intent: GoalIntent, home_state: HomeState) -> bool:
        device = next((item for item in home_state.devices if item.id == action.device_id), None)
        if not device:
            return False
        return device.room in intent.protected_rooms

    def _action_conflicts_with_active_room(self, action: PlanAction, intent: GoalIntent, home_state: HomeState) -> bool:
        device = next((item for item in home_state.devices if item.id == action.device_id), None)
        if not device:
            return False
        if device.room not in intent.protected_rooms:
            return False
        if not self._device_needed_for_activity(intent, device.room, device.type):
            return False
        return action.action_type in {"turn_off", "screen_off", "fan_off", "pause_charging"}

    def _candidate_actions(self, home_state: HomeState, intent: GoalIntent) -> tuple[list[PlanAction], list[SkippedAction], list[str]]:
        candidates: list[PlanAction] = []
        skipped: list[SkippedAction] = []
        constraints_applied = [
            "Essential devices remain powered.",
            "Only remote controllable devices can be executed.",
            "Security-related devices are preserved or scheduled for away mode.",
            "Comfort-related devices are adjusted without leaving comfort bounds.",
            "Whole-home HVAC responds to outdoor temperature and the comfort band.",
            "EV charging can be deferred instead of canceled.",
        ]
        if intent.protected_rooms:
            constraints_applied.append(f"Devices in protected rooms stay available: {', '.join(intent.protected_rooms)}.")
            constraints_applied.append("The house optimizes devices outside the active room more aggressively.")
        if intent.action_scope:
            constraints_applied.append(f"Execution is limited to the requested device scope: {', '.join(intent.action_scope)}.")
        if intent.activity != "general":
            constraints_applied.append(f"Devices needed for {intent.activity} are moved toward their desired state.")

        for device in home_state.devices:
            if not device.remote_controllable:
                skipped.append(
                    SkippedAction(
                        device_id=device.id,
                        title=f"No action for {device.name}",
                        reason="Device is not remotely controllable.",
                    )
                )
                continue

            if intent.action_scope and device.type.value not in intent.action_scope:
                skipped.append(
                    SkippedAction(
                        device_id=device.id,
                        title=f"No action for {device.name}",
                        reason=f"{device.name} is outside the requested scope for this prompt.",
                    )
                )
                continue

            target = self._desired_state_for_device(device, intent, home_state)
            if target is None:
                if device.room in intent.protected_rooms and self._device_needed_for_activity(intent, device.room, device.type):
                    skipped.append(
                        SkippedAction(
                            device_id=device.id,
                            title=f"Preserve {device.name}",
                            reason=f"{device.name} stays available because it is needed while the user is {intent.activity} in the {device.room}.",
                        )
                    )
                elif device.essential:
                    skipped.append(
                        SkippedAction(
                            device_id=device.id,
                            title=f"Leave {device.name} on",
                            reason="Essential appliance cannot be turned off.",
                        )
                    )
                continue

            if self._state_matches_target(device, target):
                if device.room in intent.protected_rooms and self._device_needed_for_activity(intent, device.room, device.type):
                    skipped.append(
                        SkippedAction(
                            device_id=device.id,
                            title=f"Preserve {device.name}",
                            reason=f"{device.name} is already in the right state for {intent.activity} in the {device.room}.",
                        )
                    )
                elif device.security_related and intent.preserve_security:
                    skipped.append(
                        SkippedAction(
                            device_id=device.id,
                            title=f"Preserve {device.name}",
                            reason="Security-related device remains active while away.",
                        )
                    )
                elif device.essential:
                    skipped.append(
                        SkippedAction(
                            device_id=device.id,
                            title=f"Leave {device.name} on",
                            reason="Essential appliance cannot be turned off.",
                        )
                    )
                continue

            candidates.append(self._build_action(device, intent, target))

            if device.type == DeviceType.APPLIANCE and device.state.is_on:
                off_state = device.state.model_copy(deep=True)
                off_state.is_on = False
                candidates.append(
                    PlanAction(
                        id=f"action_{device.id}_off",
                        device_id=device.id,
                        title=f"Turn off {device.name}",
                        description=f"Pause {device.name} to reduce power draw.",
                        reason="Deferrable appliance can be paused without comfort impact in this scenario.",
                        estimated_savings_watts=current_draw,
                        action_type="turn_off",
                        target_state=off_state,
                        priority=1,
                    )
                )

        return candidates, skipped, constraints_applied

    def _prioritize(self, candidates: list[PlanAction], intent: GoalIntent, home_state: HomeState) -> list[PlanAction]:
        def score(action: PlanAction) -> tuple[int, float]:
            bonus = 0
            if intent.mode == "away_mode" and action.action_type in {"turn_off", "screen_off", "pause_charging", "fan_off"}:
                bonus += 20
            if intent.mode == "peak_pricing" and action.action_type == "pause_charging":
                bonus += 40
            if intent.protected_rooms:
                if self._action_conflicts_with_active_room(action, intent, home_state):
                    bonus -= 400
                elif self._action_targets_protected_room(action, intent, home_state):
                    if action.action_type in {"turn_on", "screen_on", "fan_on", "fan_slow"}:
                        bonus += 140
                    else:
                        bonus -= 160
                else:
                    if action.action_type in {"turn_off", "screen_off", "fan_off", "pause_charging"}:
                        bonus += 160
                    else:
                        bonus += 40
            return (bonus - action.priority, action.estimated_savings_watts)

        return sorted(candidates, key=score, reverse=True)

    def _fallback_reasoning(
        self,
        home_state: HomeState,
        intent: GoalIntent,
        selected_plan: list[PlanAction],
    ) -> tuple[str, list[str], str]:
        assumptions = [
            "Home state telemetry is current at request time.",
            "Occupancy and pricing signals are trusted inputs.",
            "The demo smart plug lamp is reachable through the configured adapter.",
        ]

        interpreted_goal = (
            f"Mode `{intent.mode}` for goal '{intent.raw_goal}'. "
            f"Activity={intent.activity}, preserve security={intent.preserve_security}, preserve comfort={intent.preserve_comfort}, "
            f"cost sensitive={intent.cost_sensitive}, protected rooms={intent.protected_rooms}, action scope={intent.action_scope or ['all safe loads']}."
        )

        reasoning_summary = (
            "The agent first inferred the desired end state of the active room, then optimized devices outside that room "
            "while preserving essential, comfort, and security constraints."
        )
        if home_state.peak_pricing and selected_plan:
            reasoning_summary = (
                "The agent prioritized bill reduction during the active peak pricing window, while keeping activity-critical "
                "devices in the active room available and preserving non-discretionary loads."
            )
        if intent.mode == "sleep_mode":
            reasoning_summary = (
                "The agent prepared the home for sleep by keeping bedroom comfort devices available, dimming or preserving "
                "the needed bedroom lighting, and reducing unnecessary draw elsewhere."
            )

        return interpreted_goal, assumptions, reasoning_summary

    def _stabilize_selected_plan(
        self,
        *,
        intent: GoalIntent,
        home_state: HomeState,
        candidates: list[PlanAction],
        selected_plan: list[PlanAction],
    ) -> list[PlanAction]:
        baseline_plan = self._prioritize(candidates, intent, home_state)
        if not baseline_plan:
            return selected_plan

        baseline_total = sum(action.estimated_savings_watts for action in baseline_plan)
        selected_total = sum(action.estimated_savings_watts for action in selected_plan)
        selected_ids = {action.id for action in selected_plan}

        def is_obvious_desired_state_action(action: PlanAction) -> bool:
            if self._action_conflicts_with_active_room(action, intent, home_state):
                return False
            if action.action_type in {"turn_on", "screen_on", "fan_on"} and self._action_targets_protected_room(action, intent, home_state):
                return True
            if action.action_type in {"turn_off", "screen_off", "fan_off", "pause_charging"} and not self._action_targets_protected_room(action, intent, home_state):
                return True
            return False

        required_actions = [action for action in baseline_plan if is_obvious_desired_state_action(action)]
        needs_recovery = (
            not selected_plan
            or len(selected_plan) < max(3, len(required_actions) // 2)
            or selected_total < baseline_total * 0.65
        )

        if not needs_recovery:
            return selected_plan

        stabilized_plan = [action.model_copy(deep=True) for action in selected_plan]
        for action in required_actions:
            if action.id not in selected_ids and not self._action_conflicts_with_active_room(action, intent, home_state):
                stabilized_plan.append(action.model_copy(deep=True))
                selected_ids.add(action.id)

        if sum(action.estimated_savings_watts for action in stabilized_plan) < baseline_total * 0.85:
            for action in baseline_plan:
                if action.id not in selected_ids and not self._action_conflicts_with_active_room(action, intent, home_state):
                    stabilized_plan.append(action.model_copy(deep=True))
                    selected_ids.add(action.id)
                if sum(action.estimated_savings_watts for action in stabilized_plan) >= baseline_total * 0.85:
                    break

        return stabilized_plan

    def _apply_planner_output(
        self,
        *,
        default_intent: GoalIntent,
        candidates: list[PlanAction],
        skipped_actions: list[SkippedAction],
        constraints_applied: list[str],
        planner_output: dict[str, object],
        home_state: HomeState,
    ) -> tuple[GoalIntent, list[PlanAction], list[SkippedAction], list[str], list[str], str, str]:
        updated_intent = GoalIntent(
            raw_goal=default_intent.raw_goal,
            mode=str(planner_output.get("mode", default_intent.mode)),
            duration_hours=planner_output.get("duration_hours", default_intent.duration_hours),
            activity=str(planner_output.get("activity", default_intent.activity)),
            preserve_security=bool(planner_output.get("preserve_security", default_intent.preserve_security)),
            preserve_comfort=bool(planner_output.get("preserve_comfort", default_intent.preserve_comfort)),
            cost_sensitive=bool(planner_output.get("cost_sensitive", default_intent.cost_sensitive)),
            prioritize_sleep=bool(planner_output.get("prioritize_sleep", default_intent.prioritize_sleep)),
            protected_rooms=[
                str(room)
                for room in planner_output.get("protected_rooms", default_intent.protected_rooms)
                if isinstance(room, str)
            ],
            action_scope=[
                str(scope)
                for scope in planner_output.get("action_scope", default_intent.action_scope)
                if isinstance(scope, str)
            ],
        )

        candidates_by_id = {candidate.id: candidate for candidate in candidates}
        raw_selected_action_ids = planner_output.get("selected_action_ids", [])
        selected_action_ids = [
            action_id for action_id in raw_selected_action_ids if isinstance(action_id, str) and action_id in candidates_by_id
        ]

        raw_action_rationales = planner_output.get("action_rationales", [])
        planner_rationales = {
            item["action_id"]: item
            for item in raw_action_rationales
            if isinstance(item, dict) and item.get("action_id") in candidates_by_id
        }

        selected_plan: list[PlanAction] = []
        for action_id in selected_action_ids:
            action = candidates_by_id[action_id].model_copy(deep=True)
            rationale = planner_rationales.get(action_id)
            if rationale:
                action.title = str(rationale.get("title", action.title))
                action.description = str(rationale.get("description", action.description))
                action.reason = str(rationale.get("reason", action.reason))
            selected_plan.append(action)

        if not selected_plan:
            selected_plan = self._prioritize(candidates, updated_intent, home_state)

        skipped_by_device = {item.device_id: item.model_copy(deep=True) for item in skipped_actions}
        raw_skipped_actions = planner_output.get("skipped_actions", [])
        for planner_skip in raw_skipped_actions:
            if not isinstance(planner_skip, dict):
                continue
            device_id = str(planner_skip.get("device_id", ""))
            if device_id in skipped_by_device:
                skipped_by_device[device_id].title = str(planner_skip.get("title", skipped_by_device[device_id].title))
                skipped_by_device[device_id].reason = str(planner_skip.get("reason", skipped_by_device[device_id].reason))

        assumptions = [str(item) for item in planner_output.get("assumptions", [])]
        merged_constraints = [str(item) for item in planner_output.get("constraints_applied", [])] or constraints_applied
        interpreted_goal = str(planner_output.get("interpreted_goal", ""))
        reasoning_summary = str(planner_output.get("reasoning_summary", ""))

        return (
            updated_intent,
            selected_plan,
            list(skipped_by_device.values()),
            assumptions,
            merged_constraints,
            interpreted_goal or "",
            reasoning_summary or "",
        )

    def _apply_action(self, home_state: HomeState, action: PlanAction) -> HomeState:
        updated = deepcopy(home_state)
        for device in updated.devices:
            if device.id == action.device_id:
                device.state = action.target_state.model_copy(deep=True)
        return with_total_power(updated)

    def _validate_action_against_device(
        self, device: Device, action_type: str, target_state: DeviceState
    ) -> str | None:
        """Return None if the action/target_state is internally consistent, else a reason string."""
        if action_type == "turn_off":
            if target_state.is_on:
                return "turn_off requires is_on=false."
            if device.type == DeviceType.HVAC:
                if (
                    target_state.brightness is not None
                    or target_state.screen_on is not None
                    or target_state.rotation_rpm is not None
                    or target_state.charger_status is not None
                ):
                    return "HVAC target_state must have brightness, screen_on, rotation_rpm, and charger_status all null."
            return None
        if action_type == "turn_on":
            if not target_state.is_on:
                return "turn_on requires is_on=true."
            if device.type in {DeviceType.LIGHT, DeviceType.SMART_PLUG}:
                if target_state.brightness is None or target_state.brightness <= 0:
                    return "turn_on for a light/plug needs brightness > 0."
            if device.type == DeviceType.FAN and (target_state.rotation_rpm or 0) <= 0:
                return "turn_on for a fan needs rotation_rpm > 0."
            if device.type == DeviceType.HVAC:
                if (
                    target_state.brightness is not None
                    or target_state.screen_on is not None
                    or target_state.rotation_rpm is not None
                    or target_state.charger_status is not None
                ):
                    return "HVAC target_state must have brightness, screen_on, rotation_rpm, and charger_status all null."
            return None
        if action_type == "screen_off":
            if device.type != DeviceType.SCREEN:
                return "screen_off only applies to screens."
            if target_state.is_on or target_state.screen_on:
                return "screen_off requires is_on=false and screen_on=false."
            return None
        if action_type == "set_brightness":
            if device.type not in {DeviceType.LIGHT, DeviceType.SMART_PLUG}:
                return "set_brightness only applies to lights and smart plugs."
            if not target_state.is_on:
                return "set_brightness requires is_on=true (use turn_off to power down)."
            if target_state.brightness is None or not (0 < target_state.brightness <= 1):
                return "set_brightness requires brightness in (0, 1]."
            return None
        if action_type == "set_fan_speed":
            if device.type != DeviceType.FAN:
                return "set_fan_speed only applies to fans."
            rpm = target_state.rotation_rpm
            if rpm is None or rpm < 0:
                return "set_fan_speed requires rotation_rpm >= 0."
            if rpm == 0 and target_state.is_on:
                return "set_fan_speed with rpm=0 must also set is_on=false."
            if rpm > 0 and not target_state.is_on:
                return "set_fan_speed with rpm>0 must set is_on=true."
            return None
        if action_type == "pause_charging":
            if device.type != DeviceType.EV_CHARGER:
                return "pause_charging only applies to EV chargers."
            if target_state.is_on or target_state.charger_status != "paused":
                return "pause_charging requires is_on=false and charger_status='paused'."
            return None
        if action_type == "resume_charging":
            if device.type != DeviceType.EV_CHARGER:
                return "resume_charging only applies to EV chargers."
            if not target_state.is_on or target_state.charger_status != "charging":
                return "resume_charging requires is_on=true and charger_status='charging'."
            return None
        return f"Unsupported action_type '{action_type}'."

    def _convert_llm_plan(
        self, home_state: HomeState, llm_plan: LLMPlan
    ) -> tuple[list[PlanAction], list[SkippedAction], list[str]]:
        device_map = {device.id: device for device in home_state.devices}
        selected: list[PlanAction] = []
        skipped: list[SkippedAction] = [
            SkippedAction(device_id=item.device_id, title=item.title, reason=item.reason)
            for item in llm_plan.skipped
        ]
        constraints = list(llm_plan.constraints_applied) or [
            "LLM planner did not report any explicit constraints."
        ]

        for index, action in enumerate(llm_plan.plan, start=1):
            device = device_map.get(action.device_id)
            if device is None:
                skipped.append(
                    SkippedAction(
                        device_id=action.device_id,
                        title=f"Drop action for {action.device_id}",
                        reason="Unknown device id produced by LLM.",
                    )
                )
                continue
            if not device.remote_controllable:
                skipped.append(
                    SkippedAction(
                        device_id=device.id,
                        title=f"Skip {device.name}",
                        reason="Device is not remote-controllable.",
                    )
                )
                continue
            if device.essential and not action.target_state.is_on:
                skipped.append(
                    SkippedAction(
                        device_id=device.id,
                        title=f"Preserve {device.name}",
                        reason="Essential appliance cannot be turned off.",
                    )
                )
                continue
            failure = self._validate_action_against_device(
                device, action.action_type, action.target_state
            )
            if failure is not None:
                skipped.append(
                    SkippedAction(
                        device_id=device.id,
                        title=f"Reject {action.title}",
                        reason=failure,
                    )
                )
                continue

            selected.append(
                PlanAction(
                    id=f"action_{device.id}_{action.action_type}_{index}",
                    device_id=device.id,
                    title=action.title,
                    description=action.description,
                    reason=action.reason,
                    estimated_savings_watts=float(action.estimated_savings_watts),
                    action_type=action.action_type,
                    target_state=action.target_state,
                    priority=action.priority,
                )
            )

        selected.sort(key=lambda a: a.priority)
        return selected, skipped, constraints

    def _rules_assumptions(self, home_state: HomeState) -> list[str]:
        items = [
            f"Occupancy is '{home_state.occupancy.value}' at {home_state.current_time}.",
        ]
        items.append(
            "Utility pricing is elevated, so watts saved also improve near-term cost."
            if home_state.peak_pricing
            else "Utility pricing is normal, so the plan prioritizes energy savings without extra cost pressure."
        )
        items.append(
            f"Outdoor temperature is {home_state.outdoor_temp_f}°F against comfort band "
            f"{home_state.comfort_temp_range.min_f}–{home_state.comfort_temp_range.max_f}°F."
        )
        if home_state.return_time:
            items.append(f"Resident returns at {home_state.return_time}.")
        return items

    def _rules_reasoning_summary(
        self,
        intent: GoalIntent,
        selected_plan: list[PlanAction],
        skipped_actions: list[SkippedAction],
    ) -> str:
        total_saved = round(sum(a.estimated_savings_watts for a in selected_plan), 1)
        parts = [
            f"Rules planner interpreted the prompt and selected {len(selected_plan)} action(s) "
            f"for an estimated {total_saved}W reduction."
        ]
        if skipped_actions:
            preserved = "; ".join(item.title for item in skipped_actions[:3])
            parts.append(f"Preserved: {preserved}.")
        return " ".join(parts)

    def plan_and_execute(self, home_state: HomeState, goal: str) -> AgentResponse:
        intent = self.parse_goal(goal, home_state)
        llm_plan, llm_notice = plan_with_llm(home_state, goal)

        if llm_plan is not None:
            selected_plan, skipped_actions, constraints_applied = self._convert_llm_plan(
                home_state, llm_plan
            )
            assumptions = list(llm_plan.assumptions) or self._rules_assumptions(home_state)
            reasoning_summary = llm_plan.reasoning_summary
            interpreted_goal = llm_plan.interpreted_goal
            planner_label = "llm"
            planner_notice: str | None = None
        else:
            candidates, skipped_actions, constraints_applied = self._candidate_actions(home_state, intent)
            selected_plan = self._prioritize(candidates, intent, home_state)
            assumptions = self._rules_assumptions(home_state)
            reasoning_summary = self._rules_reasoning_summary(intent, selected_plan, skipped_actions)
            interpreted_goal = (
                f"Mode `{intent.mode}` for goal '{intent.raw_goal}'. "
                f"Preserve security={intent.preserve_security}, preserve comfort={intent.preserve_comfort}, "
                f"cost sensitive={intent.cost_sensitive}."
            )
            planner_label = "rules"
            planner_notice = llm_notice

        snapshots = [HomeStateSnapshot(step=0, label="Initial state", state=home_state.model_copy(deep=True))]
        execution_results: list[ExecutionResult] = []
        current_state = home_state.model_copy(deep=True)

        for index, action in enumerate(selected_plan, start=1):
            plug_message: str | None = None
            device = next(d for d in current_state.devices if d.id == action.device_id)
            prior_is_on = device.state.is_on
            if device.real_device and action.target_state.is_on != prior_is_on:
                plug_result = self.smart_plug_service.set_power(device.id, action.target_state.is_on)
                plug_message = plug_result.message

            current_state = self._apply_action(current_state, action)
            message = f"{action.description} {plug_message or 'Simulation updated successfully.'}".strip()
            execution_results.append(
                ExecutionResult(
                    action_id=action.id,
                    device_id=action.device_id,
                    title=action.title,
                    status="executed",
                    message=message,
                    resulting_power_watts=current_state.total_power_watts,
                )
            )
            snapshots.append(
                HomeStateSnapshot(
                    step=index,
                    label=action.title,
                    state=current_state.model_copy(deep=True),
                )
            )

        watts_before = home_state.total_power_watts
        watts_after = current_state.total_power_watts
        watts_saved = round(watts_before - watts_after, 2)

        return AgentResponse(
            parsed_intent=intent,
            interpreted_goal=interpreted_goal,
            assumptions=assumptions,
            constraints_applied=constraints_applied,
            reasoning_summary=reasoning_summary,
            skipped_actions=skipped_actions,
            selected_plan=selected_plan,
            execution_results=execution_results,
            initial_state=home_state,
            final_state=current_state,
            snapshots=snapshots,
            watts_before=watts_before,
            watts_after=watts_after,
            watts_saved=watts_saved,
            planner=planner_label,
            planner_notice=planner_notice,
        )
