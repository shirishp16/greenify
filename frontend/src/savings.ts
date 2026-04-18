import type { AgentResponse, PlanAction } from "./types";

export const DEFAULT_ELECTRICITY_RATE_PER_KWH = 0.16;
export const PEAK_ELECTRICITY_RATE_PER_KWH = 0.24;
export const CO2_KG_PER_KWH = 0.39;
export const MONTHLY_PROJECTION_RUNS = 12;

const HISTORY_STORAGE_KEY = "greenify.savings_history.v1";
const MAX_HISTORY_RECORDS = 500;

const BREAKDOWN_CATEGORIES = [
  "EV charging pauses",
  "Deferred laundry cycles",
  "Lighting optimizations",
  "HVAC adjustments",
  "Screen/device standby",
  "Other optimizations",
] as const;

const SEED_BREAKDOWN_WEIGHTS: Record<BreakdownCategory, number> = {
  "EV charging pauses": 0.44,
  "Deferred laundry cycles": 0.2,
  "Lighting optimizations": 0.14,
  "HVAC adjustments": 0.13,
  "Screen/device standby": 0.06,
  "Other optimizations": 0.03,
};

type BreakdownCategory = (typeof BREAKDOWN_CATEGORIES)[number];

export interface SavingsBreakdownEntry {
  category: BreakdownCategory;
  energyKwh: number;
  costUsd: number;
}

export interface RunSavingsEstimate {
  wattsSaved: number;
  durationHours: number;
  ratePerKwh: number;
  energySavedKwh: number;
  costSavedUsd: number;
  co2KgAvoided: number;
  monthlyProjectionKwh: number;
  monthlyProjectionCostUsd: number;
}

export interface SavingsRunRecord {
  id: string;
  timestamp: string;
  goal: string;
  planner: "llm" | "rules" | "none";
  durationHours: number;
  ratePerKwh: number;
  wattsSaved: number;
  energySavedKwh: number;
  costSavedUsd: number;
  co2KgAvoided: number;
  breakdown: SavingsBreakdownEntry[];
}

export interface SavingsTotals {
  energyKwh: number;
  costUsd: number;
  co2KgAvoided: number;
}

export interface MonthlySavingsPoint {
  date: string;
  label: string;
  energyKwh: number;
  costUsd: number;
  co2KgAvoided: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toMonthLabel(date: Date): string {
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function getElectricityRate(peakPricing: boolean): number {
  return peakPricing ? PEAK_ELECTRICITY_RATE_PER_KWH : DEFAULT_ELECTRICITY_RATE_PER_KWH;
}

export function estimateRunDurationHours(run: AgentResponse | null): number {
  const explicit = run?.parsed_intent.duration_hours;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return clamp(explicit, 0.5, 12);
  }
  return 1.5;
}

export function wattsToKwh(watts: number, hours: number): number {
  return Math.max(0, watts) * Math.max(0, hours) / 1000;
}

export function estimateRunSavings(run: AgentResponse | null, peakPricing: boolean): RunSavingsEstimate {
  const ratePerKwh = getElectricityRate(peakPricing);
  const durationHours = estimateRunDurationHours(run);
  const wattsSaved = Math.max(0, run?.watts_saved ?? 0);
  const energySavedKwh = wattsToKwh(wattsSaved, durationHours);
  const costSavedUsd = energySavedKwh * ratePerKwh;
  const co2KgAvoided = energySavedKwh * CO2_KG_PER_KWH;

  return {
    wattsSaved,
    durationHours,
    ratePerKwh,
    energySavedKwh,
    costSavedUsd,
    co2KgAvoided,
    monthlyProjectionKwh: energySavedKwh * MONTHLY_PROJECTION_RUNS,
    monthlyProjectionCostUsd: costSavedUsd * MONTHLY_PROJECTION_RUNS,
  };
}

function categorizeAction(action: PlanAction): BreakdownCategory {
  const signal = `${action.device_id} ${action.title} ${action.description} ${action.action_type}`.toLowerCase();

  if (signal.includes("ev") || signal.includes("charger")) {
    return "EV charging pauses";
  }
  if (signal.includes("laundry") || signal.includes("washer") || signal.includes("dryer")) {
    return "Deferred laundry cycles";
  }
  if (signal.includes("light") || signal.includes("lamp") || signal.includes("porch")) {
    return "Lighting optimizations";
  }
  if (signal.includes("hvac") || signal.includes("thermostat") || signal.includes("temperature") || signal.includes("fan")) {
    return "HVAC adjustments";
  }
  if (signal.includes("screen") || signal.includes("tv") || signal.includes("monitor") || signal.includes("plug")) {
    return "Screen/device standby";
  }
  return "Other optimizations";
}

function zeroBreakdown(): Record<BreakdownCategory, SavingsBreakdownEntry> {
  return Object.fromEntries(
    BREAKDOWN_CATEGORIES.map((category) => [
      category,
      {
        category,
        energyKwh: 0,
        costUsd: 0,
      },
    ]),
  ) as Record<BreakdownCategory, SavingsBreakdownEntry>;
}

function buildBreakdown(
  actions: PlanAction[],
  durationHours: number,
  ratePerKwh: number,
  fallbackEnergyKwh: number,
): SavingsBreakdownEntry[] {
  const bucket = zeroBreakdown();

  for (const action of actions) {
    if (action.estimated_savings_watts <= 0) {
      continue;
    }

    const category = categorizeAction(action);
    const energyKwh = wattsToKwh(action.estimated_savings_watts, durationHours);
    bucket[category].energyKwh += energyKwh;
    bucket[category].costUsd += energyKwh * ratePerKwh;
  }

  const totalActionEnergy = Object.values(bucket).reduce((sum, item) => sum + item.energyKwh, 0);
  if (totalActionEnergy <= 0 && fallbackEnergyKwh > 0) {
    bucket["Other optimizations"].energyKwh = fallbackEnergyKwh;
    bucket["Other optimizations"].costUsd = fallbackEnergyKwh * ratePerKwh;
  }

  return BREAKDOWN_CATEGORIES.map((category) => ({
    category,
    energyKwh: round(bucket[category].energyKwh),
    costUsd: round(bucket[category].costUsd),
  })).filter((entry) => entry.energyKwh > 0 || entry.costUsd > 0);
}

export function createSavingsRunRecord(run: AgentResponse): SavingsRunRecord {
  const peakPricing = run.final_state.peak_pricing;
  const estimate = estimateRunSavings(run, peakPricing);
  const breakdown = buildBreakdown(
    run.selected_plan,
    estimate.durationHours,
    estimate.ratePerKwh,
    estimate.energySavedKwh,
  );

  const timestamp = run.final_state.current_time ?? new Date().toISOString();

  return {
    id: `${Date.now()}-${Math.round(run.watts_saved)}-${run.selected_plan.length}`,
    timestamp,
    goal: run.parsed_intent.raw_goal,
    planner: run.planner ?? "none",
    durationHours: estimate.durationHours,
    ratePerKwh: estimate.ratePerKwh,
    wattsSaved: estimate.wattsSaved,
    energySavedKwh: round(estimate.energySavedKwh),
    costSavedUsd: round(estimate.costSavedUsd),
    co2KgAvoided: round(estimate.co2KgAvoided),
    breakdown,
  };
}

export function appendSavingsRecord(
  records: SavingsRunRecord[],
  record: SavingsRunRecord,
): SavingsRunRecord[] {
  const deduped = records.filter((item) => item.id !== record.id);
  const next = [...deduped, record];
  return next.slice(-MAX_HISTORY_RECORDS);
}

export function loadSavingsHistory(): SavingsRunRecord[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry): SavingsRunRecord | null => {
        if (!entry || typeof entry !== "object") {
          return null;
        }

        const candidate = entry as Partial<SavingsRunRecord>;
        if (
          typeof candidate.id !== "string" ||
          typeof candidate.timestamp !== "string" ||
          typeof candidate.energySavedKwh !== "number" ||
          typeof candidate.costSavedUsd !== "number"
        ) {
          return null;
        }

        return {
          id: candidate.id,
          timestamp: candidate.timestamp,
          goal: typeof candidate.goal === "string" ? candidate.goal : "",
          planner:
            candidate.planner === "llm" || candidate.planner === "rules" || candidate.planner === "none"
              ? candidate.planner
              : "none",
          durationHours: typeof candidate.durationHours === "number" ? candidate.durationHours : 1.5,
          ratePerKwh: typeof candidate.ratePerKwh === "number" ? candidate.ratePerKwh : DEFAULT_ELECTRICITY_RATE_PER_KWH,
          wattsSaved: typeof candidate.wattsSaved === "number" ? candidate.wattsSaved : 0,
          energySavedKwh: candidate.energySavedKwh,
          costSavedUsd: candidate.costSavedUsd,
          co2KgAvoided: typeof candidate.co2KgAvoided === "number" ? candidate.co2KgAvoided : candidate.energySavedKwh * CO2_KG_PER_KWH,
          breakdown: Array.isArray(candidate.breakdown)
            ? candidate.breakdown
                .filter((item): item is SavingsBreakdownEntry => {
                  return (
                    Boolean(item) &&
                    typeof item === "object" &&
                    typeof (item as SavingsBreakdownEntry).category === "string" &&
                    typeof (item as SavingsBreakdownEntry).energyKwh === "number" &&
                    typeof (item as SavingsBreakdownEntry).costUsd === "number"
                  );
                })
                .map((item) => ({
                  category: BREAKDOWN_CATEGORIES.includes(item.category as BreakdownCategory)
                    ? (item.category as BreakdownCategory)
                    : "Other optimizations",
                  energyKwh: item.energyKwh,
                  costUsd: item.costUsd,
                }))
            : [],
        };
      })
      .filter((record): record is SavingsRunRecord => record !== null);
  } catch (_error) {
    return [];
  }
}

export function saveSavingsHistory(records: SavingsRunRecord[]): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(records));
}

function seedSeries(points: MonthlySavingsPoint[], fallbackRun: RunSavingsEstimate | null): MonthlySavingsPoint[] {
  const baseEnergy = clamp(fallbackRun?.energySavedKwh ? fallbackRun.energySavedKwh * 0.55 : 1.25, 0.65, 3.8);

  return points.map((point, index) => {
    const date = new Date(point.date);
    const weekday = date.getDay();
    const weekendFactor = weekday === 0 || weekday === 6 ? 1.12 : 0.96;
    const seasonalWave = 1 + Math.sin((index / points.length) * Math.PI * 2) * 0.18;
    const energyKwh = round(baseEnergy * weekendFactor * seasonalWave);
    const ratePerKwh = weekday >= 1 && weekday <= 5 ? DEFAULT_ELECTRICITY_RATE_PER_KWH : DEFAULT_ELECTRICITY_RATE_PER_KWH * 0.92;
    const costUsd = round(energyKwh * ratePerKwh);

    return {
      ...point,
      energyKwh,
      costUsd,
      co2KgAvoided: round(energyKwh * CO2_KG_PER_KWH),
    };
  });
}

export function buildMonthlySavingsSeries(
  records: SavingsRunRecord[],
  now = new Date(),
  fallbackRun: RunSavingsEstimate | null = null,
): MonthlySavingsPoint[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const days = 30;
  const points: MonthlySavingsPoint[] = [];
  const dailyTotals = new Map<string, SavingsTotals>();

  for (const record of records) {
    const date = new Date(record.timestamp);
    if (Number.isNaN(date.getTime())) {
      continue;
    }
    date.setHours(0, 0, 0, 0);

    const daysFromToday = Math.floor((today.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
    if (daysFromToday < 0 || daysFromToday >= days) {
      continue;
    }

    const key = toDateKey(date);
    const existing = dailyTotals.get(key) ?? { energyKwh: 0, costUsd: 0, co2KgAvoided: 0 };
    dailyTotals.set(key, {
      energyKwh: existing.energyKwh + record.energySavedKwh,
      costUsd: existing.costUsd + record.costSavedUsd,
      co2KgAvoided: existing.co2KgAvoided + record.co2KgAvoided,
    });
  }

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = toDateKey(date);
    const totals = dailyTotals.get(key) ?? { energyKwh: 0, costUsd: 0, co2KgAvoided: 0 };

    points.push({
      date: key,
      label: toMonthLabel(date),
      energyKwh: round(totals.energyKwh),
      costUsd: round(totals.costUsd),
      co2KgAvoided: round(totals.co2KgAvoided),
    });
  }

  const hasRealData = points.some((point) => point.energyKwh > 0 || point.costUsd > 0);
  if (hasRealData) {
    return points;
  }

  return seedSeries(points, fallbackRun);
}

export function summarizeSavingsSeries(points: MonthlySavingsPoint[]): SavingsTotals {
  return points.reduce(
    (totals, point) => ({
      energyKwh: totals.energyKwh + point.energyKwh,
      costUsd: totals.costUsd + point.costUsd,
      co2KgAvoided: totals.co2KgAvoided + point.co2KgAvoided,
    }),
    { energyKwh: 0, costUsd: 0, co2KgAvoided: 0 },
  );
}

export function getTodayTotals(records: SavingsRunRecord[], now = new Date()): SavingsTotals {
  const key = toDateKey(now);
  return records.reduce(
    (totals, record) => {
      const date = new Date(record.timestamp);
      if (Number.isNaN(date.getTime()) || toDateKey(date) !== key) {
        return totals;
      }

      return {
        energyKwh: totals.energyKwh + record.energySavedKwh,
        costUsd: totals.costUsd + record.costSavedUsd,
        co2KgAvoided: totals.co2KgAvoided + record.co2KgAvoided,
      };
    },
    { energyKwh: 0, costUsd: 0, co2KgAvoided: 0 },
  );
}

export function getMonthTotals(records: SavingsRunRecord[], now = new Date()): SavingsTotals {
  const month = now.getMonth();
  const year = now.getFullYear();

  return records.reduce(
    (totals, record) => {
      const date = new Date(record.timestamp);
      if (Number.isNaN(date.getTime()) || date.getMonth() !== month || date.getFullYear() !== year) {
        return totals;
      }

      return {
        energyKwh: totals.energyKwh + record.energySavedKwh,
        costUsd: totals.costUsd + record.costSavedUsd,
        co2KgAvoided: totals.co2KgAvoided + record.co2KgAvoided,
      };
    },
    { energyKwh: 0, costUsd: 0, co2KgAvoided: 0 },
  );
}

export function buildMonthlyBreakdown(
  records: SavingsRunRecord[],
  now = new Date(),
  fallbackTotals?: SavingsTotals,
): SavingsBreakdownEntry[] {
  const month = now.getMonth();
  const year = now.getFullYear();
  const bucket = zeroBreakdown();

  for (const record of records) {
    const date = new Date(record.timestamp);
    if (Number.isNaN(date.getTime()) || date.getMonth() !== month || date.getFullYear() !== year) {
      continue;
    }

    for (const entry of record.breakdown) {
      const category = BREAKDOWN_CATEGORIES.includes(entry.category)
        ? entry.category
        : "Other optimizations";
      bucket[category].energyKwh += entry.energyKwh;
      bucket[category].costUsd += entry.costUsd;
    }
  }

  const entries = BREAKDOWN_CATEGORIES.map((category) => ({
    category,
    energyKwh: round(bucket[category].energyKwh),
    costUsd: round(bucket[category].costUsd),
  }));

  const hasBreakdown = entries.some((entry) => entry.energyKwh > 0 || entry.costUsd > 0);
  if (hasBreakdown) {
    return entries.filter((entry) => entry.energyKwh > 0 || entry.costUsd > 0).sort((a, b) => b.costUsd - a.costUsd);
  }

  if (!fallbackTotals || fallbackTotals.energyKwh <= 0 || fallbackTotals.costUsd <= 0) {
    return [];
  }

  return BREAKDOWN_CATEGORIES.map((category) => ({
    category,
    energyKwh: round(fallbackTotals.energyKwh * SEED_BREAKDOWN_WEIGHTS[category]),
    costUsd: round(fallbackTotals.costUsd * SEED_BREAKDOWN_WEIGHTS[category]),
  })).sort((a, b) => b.costUsd - a.costUsd);
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 10 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatKwh(value: number): string {
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} kWh`;
}
