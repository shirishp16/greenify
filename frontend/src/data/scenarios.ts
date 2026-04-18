import type { ScenarioId } from "../types";

export interface ScenarioPreset {
  id: ScenarioId;
  label: string;
  shortLabel: string;
  goal: string;
}

export const scenarioPresets: ScenarioPreset[] = [
  {
    id: "away_mode",
    label: "Away mode",
    shortLabel: "Away",
    goal: "I'm leaving for 3 hours. Reduce energy use but keep the house secure.",
  },
  {
    id: "peak_pricing",
    label: "Peak pricing",
    shortLabel: "Peak",
    goal: "Lower my bill during peak hours without making the house uncomfortable.",
  },
  {
    id: "sleep_mode",
    label: "Sleep mode",
    shortLabel: "Sleep",
    goal: "Prepare the house for sleep mode.",
  },
];
