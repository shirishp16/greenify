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
            if intent.mode == "peak_pricing" and action.action_type == "pause_charging":
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

    def _validate_action_against_device(
        self, device: Device, action_type: str, target_state: DeviceState
    ) -> str | None:
        """Return None if the action/target_state is internally consistent, else a reason string."""
        if action_type == "turn_off":
            if target_state.is_on:
                return "turn_off requires is_on=false."
            return None
        if action_type == "turn_on":
            if not target_state.is_on:
                return "turn_on requires is_on=true."
            if device.type in {DeviceType.LIGHT, DeviceType.SMART_PLUG}:
                if target_state.brightness is None or target_state.brightness <= 0:
                    return "turn_on for a light/plug needs brightness > 0."
            if device.type == DeviceType.FAN and (target_state.rotation_rpm or 0) <= 0:
                return "turn_on for a fan needs rotation_rpm > 0."
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
            "Utility peak-pricing window is active — watts saved convert directly to cost saved."
            if home_state.peak_pricing
            else "Pricing is off-peak; savings are energy-only rather than cost-urgent."
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
        mode_label = {
            "sleep_mode": "sleep-prep",
            "away_mode": "away",
            "peak_pricing": "peak-pricing",
            "custom": "custom",
        }.get(intent.mode, intent.mode)
        total_saved = round(sum(a.estimated_savings_watts for a in selected_plan), 1)
        parts = [
            f"Rules planner ran {mode_label} mode and selected {len(selected_plan)} action(s) "
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
            selected_plan = self._prioritize(candidates, intent)
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
