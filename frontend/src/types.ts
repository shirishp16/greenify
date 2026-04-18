export type Occupancy = "home" | "away" | "asleep";

export type DeviceType = "light" | "screen" | "fan" | "fridge" | "ev_charger" | "smart_plug";

export interface DeviceState {
  is_on: boolean;
  brightness: number | null;
  screen_on: boolean | null;
  rotation_rpm: number | null;
  charger_status: string | null;
  scheduled: boolean;
  schedule_note: string | null;
}

export interface Device {
  id: string;
  name: string;
  room: string;
  type: DeviceType;
  state: DeviceState;
  power_watts: number;
  essential: boolean;
  security_related: boolean;
  comfort_related: boolean;
  remote_controllable: boolean;
  can_defer: boolean;
  real_device: boolean;
  notes: string;
}

export interface ComfortRange {
  min_f: number;
  max_f: number;
}

export interface HomeState {
  occupancy: Occupancy;
  current_time: string;
  return_time: string | null;
  peak_pricing: boolean;
  outdoor_temp_f: number;
  comfort_temp_range: ComfortRange;
  mode_label: string;
  devices: Device[];
  total_power_watts: number;
}

export interface PlanAction {
  id: string;
  device_id: string;
  title: string;
  description: string;
  reason: string;
  estimated_savings_watts: number;
  action_type: string;
  target_state: DeviceState;
  priority: number;
}

export interface SkippedAction {
  device_id: string;
  title: string;
  reason: string;
}

export interface ExecutionResult {
  action_id: string;
  device_id: string;
  title: string;
  status: "executed" | "skipped";
  message: string;
  resulting_power_watts: number;
}

export interface HomeStateSnapshot {
  step: number;
  label: string;
  state: HomeState;
}

export interface AgentResponse {
  interpreted_goal: string;
  assumptions: string[];
  constraints_applied: string[];
  reasoning_summary: string;
  skipped_actions: SkippedAction[];
  selected_plan: PlanAction[];
  execution_results: ExecutionResult[];
  initial_state: HomeState;
  final_state: HomeState;
  snapshots: HomeStateSnapshot[];
  watts_before: number;
  watts_after: number;
  watts_saved: number;
}

export type ScenarioId = "away_mode" | "peak_pricing" | "sleep_mode";
