from __future__ import annotations

import re
from copy import deepcopy

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
from app.services.smart_plug import SmartPlugService


class EnergyAgent:
    def __init__(self, smart_plug_service: SmartPlugService) -> None:
        self.smart_plug_service = smart_plug_service

    def parse_goal(self, goal: str, home_state: HomeState) -> GoalIntent:
        normalized = goal.lower().strip()
        duration_match = re.search(r"(\d+(?:\.\d+)?)\s*hour", normalized)
        duration_hours = float(duration_match.group(1)) if duration_match else None

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
            preserve_security="secure" in normalized or home_state.occupancy == Occupancy.AWAY,
            preserve_comfort="comfortable" in normalized or "comfort" in normalized or home_state.occupancy == Occupancy.HOME,
            cost_sensitive="bill" in normalized or home_state.peak_pricing,
            prioritize_sleep="sleep" in normalized,
        )

    def _candidate_actions(self, home_state: HomeState, intent: GoalIntent) -> tuple[list[PlanAction], list[SkippedAction], list[str]]:
        candidates: list[PlanAction] = []
        skipped: list[SkippedAction] = []
        constraints_applied = [
            "Essential devices remain powered.",
            "Only remote controllable devices can be executed.",
            "Security-related devices are preserved or scheduled for away mode.",
            "Comfort-related devices are adjusted without leaving comfort bounds.",
            "EV charging can be deferred instead of canceled.",
        ]

        for device in home_state.devices:
            current_draw = compute_device_draw(device)

            if not device.remote_controllable:
                skipped.append(
                    SkippedAction(
                        device_id=device.id,
                        title=f"No action for {device.name}",
                        reason="Device is not remotely controllable.",
                    )
                )
                continue

            if device.essential:
                skipped.append(
                    SkippedAction(
                        device_id=device.id,
                        title=f"Leave {device.name} on",
                        reason="Essential appliance cannot be turned off.",
                    )
                )
                continue

            if device.security_related and intent.preserve_security:
                scheduled_state = device.state.model_copy(deep=True)
                scheduled_state.is_on = True
                scheduled_state.scheduled = True
                scheduled_state.schedule_note = "Keep active while away for visibility."
                skipped.append(
                    SkippedAction(
                        device_id=device.id,
                        title=f"Preserve {device.name}",
                        reason="Security-related device remains active while away.",
                    )
                )
                continue

            if device.type in {DeviceType.LIGHT, DeviceType.SMART_PLUG} and device.state.is_on:
                off_state = device.state.model_copy(deep=True)
                off_state.is_on = False
                off_state.brightness = 0
                candidates.append(
                    PlanAction(
                        id=f"action_{device.id}_off",
                        device_id=device.id,
                        title=f"Turn off {device.name}",
                        description=f"Power down {device.name} in the {device.room}.",
                        reason="Lighting can be reduced without affecting safety in this scenario.",
                        estimated_savings_watts=current_draw,
                        action_type="turn_off",
                        target_state=off_state,
                        priority=1,
                    )
                )

            if device.type == DeviceType.SCREEN and device.state.screen_on:
                screen_state = device.state.model_copy(deep=True)
                screen_state.screen_on = False
                screen_state.is_on = False
                candidates.append(
                    PlanAction(
                        id=f"action_{device.id}_screen_off",
                        device_id=device.id,
                        title=f"Turn off {device.name}",
                        description=f"Shut down {device.name} to eliminate standby use.",
                        reason="Unused displays are high-value discretionary loads.",
                        estimated_savings_watts=current_draw,
                        action_type="screen_off",
                        target_state=screen_state,
                        priority=2,
                    )
                )

            if device.type == DeviceType.FAN and device.state.rotation_rpm:
                if intent.mode == "sleep_mode" and device.room == "bedroom":
                    low_state = device.state.model_copy(deep=True)
                    low_state.rotation_rpm = 90
                    candidates.append(
                        PlanAction(
                            id=f"action_{device.id}_sleep_low",
                            device_id=device.id,
                            title=f"Set {device.name} to sleep speed",
                            description=f"Slow {device.name} for overnight comfort with less draw.",
                            reason="Sleep mode keeps airflow while trimming energy use.",
                            estimated_savings_watts=25,
                            action_type="fan_slow",
                            target_state=low_state,
                            priority=3,
                        )
                    )
                elif intent.mode == "peak_pricing" and home_state.outdoor_temp_f >= 80:
                    low_state = device.state.model_copy(deep=True)
                    low_state.rotation_rpm = 120
                    candidates.append(
                        PlanAction(
                            id=f"action_{device.id}_eco",
                            device_id=device.id,
                            title=f"Reduce {device.name} to eco speed",
                            description=f"Lower fan speed while maintaining comfort.",
                            reason="Peak pricing asks for reduced draw without making the room uncomfortable.",
                            estimated_savings_watts=18,
                            action_type="fan_slow",
                            target_state=low_state,
                            priority=4,
                        )
                    )
                else:
                    off_state = device.state.model_copy(deep=True)
                    off_state.rotation_rpm = 0
                    off_state.is_on = False
                    candidates.append(
                        PlanAction(
                            id=f"action_{device.id}_off",
                            device_id=device.id,
                            title=f"Turn off {device.name}",
                            description=f"Stop {device.name} while the room is unoccupied.",
                            reason="Fan can be safely stopped in this scenario.",
                            estimated_savings_watts=current_draw,
                            action_type="fan_off",
                            target_state=off_state,
                            priority=4,
                        )
                    )

            if device.type == DeviceType.EV_CHARGER and device.state.charger_status == "charging":
                paused_state = device.state.model_copy(deep=True)
                paused_state.charger_status = "paused"
                paused_state.is_on = False
                paused_state.scheduled = True
                paused_state.schedule_note = "Resume after the active optimization window."
                candidates.append(
                    PlanAction(
                        id=f"action_{device.id}_pause",
                        device_id=device.id,
                        title="Pause EV charging",
                        description="Defer EV charging until the optimization window ends.",
                        reason="Flexible high-load device is the largest savings opportunity.",
                        estimated_savings_watts=current_draw,
                        action_type="pause_charging",
                        target_state=paused_state,
                        priority=0,
                    )
                )

        return candidates, skipped, constraints_applied

    def _prioritize(self, candidates: list[PlanAction], intent: GoalIntent) -> list[PlanAction]:
        def score(action: PlanAction) -> tuple[int, float]:
            bonus = 0
            if intent.mode == "away_mode" and action.action_type in {"turn_off", "screen_off", "pause_charging"}:
                bonus += 20
            if intent.mode == "peak_pricing" and action.device_id == "garage_ev_charger":
                bonus += 40
            if intent.mode == "sleep_mode" and "bedroom" in action.description.lower():
                bonus += 15
            return (bonus - action.priority, action.estimated_savings_watts)

        return sorted(candidates, key=score, reverse=True)

    def _apply_action(self, home_state: HomeState, action: PlanAction) -> HomeState:
        updated = deepcopy(home_state)
        for device in updated.devices:
            if device.id == action.device_id:
                device.state = action.target_state.model_copy(deep=True)
        return with_total_power(updated)

    def plan_and_execute(self, home_state: HomeState, goal: str) -> AgentResponse:
        intent = self.parse_goal(goal, home_state)
        candidates, skipped_actions, constraints_applied = self._candidate_actions(home_state, intent)
        selected_plan = self._prioritize(candidates, intent)

        assumptions = [
            "Home state telemetry is current at request time.",
            "Occupancy and pricing signals are trusted inputs.",
            "The demo smart plug lamp is reachable through the configured adapter.",
        ]

        interpreted_goal = (
            f"Mode `{intent.mode}` for goal '{intent.raw_goal}'. "
            f"Preserve security={intent.preserve_security}, preserve comfort={intent.preserve_comfort}, "
            f"cost sensitive={intent.cost_sensitive}."
        )

        snapshots = [HomeStateSnapshot(step=0, label="Initial state", state=home_state.model_copy(deep=True))]
        execution_results: list[ExecutionResult] = []
        current_state = home_state.model_copy(deep=True)

        for index, action in enumerate(selected_plan, start=1):
            plug_message = None
            device = next(device for device in current_state.devices if device.id == action.device_id)
            if device.real_device:
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

        reasoning_summary = (
            "The agent ranked flexible loads first, preserved essential and security-related devices, "
            "and chose high-savings actions that fit the active mode without violating comfort constraints."
        )

        return AgentResponse(
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
        )
