import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { getHomeState, planAndExecute, toggleDevice } from "./api";
import { HouseScene } from "./components/HouseScene";
import { MonthlySavingsModal } from "./components/MonthlySavingsModal";
import { SectionCard } from "./components/SectionCard";
import {
  appendSavingsRecord,
  buildMonthlyBreakdown,
  buildMonthlySavingsSeries,
  createSavingsRunRecord,
  estimateRunSavings,
  formatCurrency,
  formatKwh,
  getElectricityRate,
  getMonthTotals,
  getTodayTotals,
  loadSavingsHistory,
  saveSavingsHistory,
  summarizeSavingsSeries,
  wattsToKwh,
  type SavingsRunRecord,
} from "./savings";
import type { AgentResponse, ChatLogMessage, HomeState } from "./types";
import { formatWatts } from "./utils";

const CHAT_LOG_STORAGE_KEY = "greenify.chat_log.v1";
const MAX_CHAT_LOG_MESSAGES = 80;
const MAX_CHAT_HISTORY_FOR_PROMPT = 16;

function trimChatLog(messages: ChatLogMessage[]): ChatLogMessage[] {
  return messages.slice(-MAX_CHAT_LOG_MESSAGES);
}

function loadChatLog(): ChatLogMessage[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(CHAT_LOG_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((message): message is ChatLogMessage => {
        return (
          Boolean(message) &&
          typeof message === "object" &&
          ((message as ChatLogMessage).role === "user" || (message as ChatLogMessage).role === "assistant") &&
          typeof (message as ChatLogMessage).content === "string"
        );
      })
      .map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
      }));
  } catch (_error) {
    return [];
  }
}

function saveChatLog(messages: ChatLogMessage[]): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(CHAT_LOG_STORAGE_KEY, JSON.stringify(messages));
}

function formatChatTimestamp(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function App() {
  const [goal, setGoal] = useState("");
  const [displayedState, setDisplayedState] = useState<HomeState | null>(null);
  const [serverState, setServerState] = useState<HomeState | null>(null);
  const [agentRun, setAgentRun] = useState<AgentResponse | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [activeStepLabel, setActiveStepLabel] = useState("Ready");
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMonthlySavingsOpen, setIsMonthlySavingsOpen] = useState(false);
  const [monthlyView, setMonthlyView] = useState<"cost" | "energy">("cost");
  const [savingsHistory, setSavingsHistory] = useState<SavingsRunRecord[]>(() => loadSavingsHistory());
  const [chatLog, setChatLog] = useState<ChatLogMessage[]>(() => loadChatLog());
  const playbackVersion = useRef(0);

  useEffect(() => {
    void loadInitialState();
  }, []);

  useEffect(() => {
    saveSavingsHistory(savingsHistory);
  }, [savingsHistory]);

  useEffect(() => {
    saveChatLog(chatLog);
  }, [chatLog]);

  async function loadInitialState() {
    try {
      setIsLoading(true);
      const homeState = await getHomeState();
      setDisplayedState(homeState);
      setServerState(homeState);
      setActiveStep(0);
      setActiveStepLabel("Ready");
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load home state.");
    } finally {
      setIsLoading(false);
    }
  }

  async function playback(response: AgentResponse) {
    playbackVersion.current += 1;
    const version = playbackVersion.current;

    setIsRunning(true);
    setActiveStep(0);
    setActiveStepLabel(response.snapshots[0]?.label ?? "Initial state");
    setDisplayedState(response.initial_state);

    if (response.snapshots.length === 0) {
      setDisplayedState(response.final_state);
      setServerState(response.final_state);
      setIsRunning(false);
      return;
    }

    for (const snapshot of response.snapshots) {
      if (version !== playbackVersion.current) {
        setIsRunning(false);
        return;
      }

      setDisplayedState(snapshot.state);
      setActiveStep(snapshot.step);
      setActiveStepLabel(snapshot.label);
      await new Promise((resolve) => window.setTimeout(resolve, snapshot.step === 0 ? 600 : 1100));
    }

    setServerState(response.final_state);
    setIsRunning(false);
  }

  async function handleDeviceToggle(deviceId: string) {
    if (isRunning) return;
    playbackVersion.current += 1;
    try {
      setError(null);
      const updated = await toggleDevice(deviceId);
      setDisplayedState(updated);
      setServerState(updated);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Toggle failed.");
    }
  }

  async function handleRunAgent() {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) {
      return;
    }

    const userMessage: ChatLogMessage = {
      role: "user",
      content: trimmedGoal,
      timestamp: new Date().toISOString(),
    };
    const promptHistory = trimChatLog([...chatLog, userMessage]).slice(-MAX_CHAT_HISTORY_FOR_PROMPT);

    try {
      setError(null);
      setIsRunning(true);
      setChatLog((current) => trimChatLog([...current, userMessage]));

      const response = await planAndExecute(trimmedGoal, promptHistory);
      setAgentRun(response);
      setSavingsHistory((current) => appendSavingsRecord(current, createSavingsRunRecord(response)));

      const assistantSummary = `${response.interpreted_goal} Executed ${response.selected_plan.length} action(s), saved ${formatWatts(
        response.watts_saved,
      )}.${response.skipped_actions.length > 0 ? ` Skipped ${response.skipped_actions.length} action(s) for safety.` : ""}`;
      setChatLog((current) =>
        trimChatLog([
          ...current,
          {
            role: "assistant",
            content: assistantSummary,
            timestamp: new Date().toISOString(),
          },
        ]),
      );
      await playback(response);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Agent execution failed.");
      setChatLog((current) =>
        trimChatLog([
          ...current,
          {
            role: "assistant",
            content: runError instanceof Error ? `Run failed: ${runError.message}` : "Run failed.",
            timestamp: new Date().toISOString(),
          },
        ]),
      );
      setIsRunning(false);
    }
  }

  const modeSource = displayedState ?? serverState;
  const parsedIntent = agentRun?.parsed_intent;
  const stepTotal = agentRun?.selected_plan.length ?? 0;
  const stepsCompleted = Math.min(activeStep, stepTotal);
  const progressPercent = stepTotal > 0 ? Math.round((stepsCompleted / stepTotal) * 100) : 0;

  const optimizerLabel = agentRun
    ? agentRun.planner === "llm"
      ? "Greenify Intelligence"
      : "Safety Rules Engine"
    : "Standby";

  const workflowStatus = isLoading ? "Loading home state" : isRunning ? "Executing optimization" : agentRun ? "Run complete" : "Ready";
  const currentRatePerKwh = getElectricityRate(Boolean(modeSource?.peak_pricing));

  const runEstimate = useMemo(
    () => estimateRunSavings(agentRun, Boolean(agentRun?.final_state.peak_pricing ?? modeSource?.peak_pricing)),
    [agentRun, modeSource?.peak_pricing],
  );

  const monthlyPoints = useMemo(
    () => buildMonthlySavingsSeries(savingsHistory, new Date(), runEstimate),
    [runEstimate, savingsHistory],
  );

  const monthlyTotals = useMemo(() => summarizeSavingsSeries(monthlyPoints), [monthlyPoints]);
  const monthTotalsFromRuns = useMemo(() => getMonthTotals(savingsHistory), [savingsHistory]);
  const todayTotals = useMemo(() => getTodayTotals(savingsHistory), [savingsHistory]);

  const monthBreakdown = useMemo(
    () => buildMonthlyBreakdown(savingsHistory, new Date(), monthlyTotals),
    [monthlyTotals, savingsHistory],
  );

  const hasRecentHistory = useMemo(() => {
    const now = new Date();
    return savingsHistory.some((record) => {
      const date = new Date(record.timestamp);
      if (Number.isNaN(date.getTime())) {
        return false;
      }
      return now.getTime() - date.getTime() <= 30 * 24 * 60 * 60 * 1000;
    });
  }, [savingsHistory]);

  const thisMonthRuns = useMemo(() => {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    return savingsHistory.filter((record) => {
      const date = new Date(record.timestamp);
      return !Number.isNaN(date.getTime()) && date.getMonth() === month && date.getFullYear() === year;
    }).length;
  }, [savingsHistory]);

  const averageMonthRatePerKwh = useMemo(() => {
    if (monthTotalsFromRuns.energyKwh > 0) {
      return monthTotalsFromRuns.costUsd / monthTotalsFromRuns.energyKwh;
    }
    return currentRatePerKwh;
  }, [currentRatePerKwh, monthTotalsFromRuns.costUsd, monthTotalsFromRuns.energyKwh]);

  const chatPreview = chatLog.slice(-10);

  return (
    <div className="app-shell min-h-screen px-4 py-6 text-stone-800 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1700px]">
        <motion.header
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 grid gap-4 xl:grid-cols-[1.08fr_0.92fr]"
        >
          <div className="panel p-4 sm:p-5">
            <div className="brand-mark">
              <span className="brand-mark__glyph" aria-hidden="true" />
              <span className="brand-mark__text">Greenify</span>
            </div>

            <div className="mt-2 rounded-2xl border border-stone-900/10 bg-stone-50/85 p-3.5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Conversation Memory</div>
                <button
                  type="button"
                  className="rounded-md border border-stone-900/10 bg-stone-100 px-2 py-1 text-xs text-stone-600 transition hover:bg-stone-200"
                  onClick={() => setChatLog([])}
                  disabled={chatLog.length === 0}
                >
                  Clear
                </button>
              </div>

              <p className="mb-2 text-xs text-stone-500">
                Saved locally and sent as context for follow-up prompts so new goals can reference prior instructions.
              </p>

              <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                {chatPreview.length > 0 ? (
                  chatPreview.map((message, index) => (
                    <div
                      key={`${message.role}-${message.timestamp ?? "no-ts"}-${index}`}
                      className={`rounded-xl px-3 py-2 text-sm ${
                        message.role === "user" ? "border border-accent/25 bg-accent/10 text-stone-800" : "bg-stone-900/6 text-stone-700"
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-stone-500">
                        <span>{message.role === "user" ? "You" : "Greenify"}</span>
                        <span>{formatChatTimestamp(message.timestamp)}</span>
                      </div>
                      <div>{message.content}</div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl bg-stone-900/6 px-3 py-2 text-sm text-stone-500">
                    No chat history yet. Your runs and optimizer responses will appear here.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="panel p-6 sm:p-7">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Run Status</div>
                <div className="mt-1 text-2xl font-semibold text-stone-900">{workflowStatus}</div>
              </div>
              <button
                type="button"
                className="rounded-xl border border-accent/35 bg-accent/12 px-3 py-2 text-sm font-medium text-accent transition hover:bg-accent/18"
                onClick={() => setIsMonthlySavingsOpen(true)}
              >
                View Monthly Savings
              </button>
            </div>

            <div className="mb-2 text-sm text-stone-600">{activeStepLabel}</div>
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-stone-500">
              <span>Execution Progress</span>
              <span>
                {stepsCompleted}/{stepTotal || 0}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-stone-900/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent to-green-500 transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-stone-900/5 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-stone-500">Before Load</div>
                <div className="text-lg font-semibold text-stone-900">
                  {formatWatts(agentRun?.watts_before ?? serverState?.total_power_watts ?? 0)}
                </div>
              </div>
              <div className="rounded-2xl bg-stone-900/5 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-stone-500">After Load</div>
                <div className="text-lg font-semibold text-stone-900">
                  {formatWatts(agentRun?.watts_after ?? displayedState?.total_power_watts ?? 0)}
                </div>
              </div>
              <div className="rounded-2xl border border-success/30 bg-success/10 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-success">Saved</div>
                <div className="text-lg font-semibold text-stone-900">{formatWatts(runEstimate.wattsSaved)}</div>
              </div>
              <div className="rounded-2xl border border-accent/25 bg-accent/10 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-accent">Estimated Value</div>
                <div className="text-lg font-semibold text-stone-900">{formatCurrency(runEstimate.costSavedUsd)}</div>
              </div>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-stone-900/10 bg-stone-50/90 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-stone-500">This Run</div>
                <div className="mt-1 text-sm font-semibold text-stone-900">
                  {formatKwh(runEstimate.energySavedKwh)} • {formatCurrency(runEstimate.costSavedUsd)}
                </div>
              </div>
              <div className="rounded-2xl border border-stone-900/10 bg-stone-50/90 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Today</div>
                <div className="mt-1 text-sm font-semibold text-stone-900">
                  {formatKwh(todayTotals.energyKwh)} • {formatCurrency(todayTotals.costUsd)}
                </div>
              </div>
              <div className="rounded-2xl border border-stone-900/10 bg-stone-50/90 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Monthly Projection</div>
                <div className="mt-1 text-sm font-semibold text-stone-900">
                  {formatKwh(monthlyTotals.energyKwh)} • {formatCurrency(monthlyTotals.costUsd)}
                </div>
              </div>
            </div>
          </div>
        </motion.header>

        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
          <div className="space-y-6">
            <SectionCard
              title="1. Define The Goal"
              eyebrow="Workflow"
              subtitle="Describe what outcome you want. Greenify Intelligence will optimize for savings while honoring safety and comfort constraints."
            >
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                rows={5}
                className="input-surface mb-4 w-full"
                placeholder="Example: I'm leaving for 3 hours. Reduce energy use but keep the house secure."
              />

              <button
                type="button"
                onClick={() => void handleRunAgent()}
                disabled={isLoading || isRunning || !goal.trim()}
                className="w-full rounded-2xl bg-gradient-to-r from-accent to-green-500 px-4 py-3 text-sm font-semibold text-white ring-1 ring-accent/30 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRunning ? "Executing Optimization..." : "Run Optimizer"}
              </button>

              {error ? (
                <p className="mt-3 rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
              ) : null}
            </SectionCard>

            <SectionCard
              title="2. Watch The Home Simulation"
              eyebrow="Simulation"
              subtitle="The home scene replays backend snapshots in execution order so you can see exactly what changed and when."
            >
              <HouseScene
                homeState={displayedState}
                activeStepLabel={isLoading ? "Loading" : activeStepLabel}
                protectedRooms={parsedIntent?.protected_rooms ?? []}
                actionScope={parsedIntent?.action_scope ?? []}
                onDeviceToggle={handleDeviceToggle}
              />
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-stone-900/10 bg-stone-900/5 p-3 text-sm text-stone-600">
                  <div className="mb-1 text-xs uppercase tracking-[0.18em] text-stone-500">Protected Rooms</div>
                  Rooms needed for the activity are highlighted and preserved.
                </div>
                <div className="rounded-2xl border border-stone-900/10 bg-stone-900/5 p-3 text-sm text-stone-600">
                  <div className="mb-1 text-xs uppercase tracking-[0.18em] text-stone-500">Action Scope</div>
                  If prompt scope is narrow, only those device types are eligible.
                </div>
                <div className="rounded-2xl border border-stone-900/10 bg-stone-900/5 p-3 text-sm text-stone-600">
                  <div className="mb-1 text-xs uppercase tracking-[0.18em] text-stone-500">Execution Timeline</div>
                  Current step label maps directly to the backend execution snapshot.
                </div>
              </div>
            </SectionCard>
          </div>

          <div className="space-y-6">
            <SectionCard
              title="Decision Console"
              eyebrow="Greenify Intelligence"
              subtitle="Concise run summary first, detailed reasoning and constraints below."
              className="border-l-2 border-l-accent/30"
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span
                  className={`data-pill ${
                    agentRun?.planner === "llm"
                      ? "border-accent/30 bg-accent/15 text-accent"
                      : "border-stone-900/10 bg-stone-900/5 text-stone-600"
                  }`}
                >
                  Engine: {optimizerLabel}
                </span>
                {agentRun?.planner_notice ? <span className="text-xs text-stone-500">{agentRun.planner_notice}</span> : null}
              </div>

              <div className="mb-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-accent/20 bg-accent/10 p-4">
                  <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-accent">Goal Understood</div>
                  <div className="text-sm leading-6 text-stone-800">
                    {agentRun?.interpreted_goal ?? "Run the optimizer to translate your prompt into a concrete energy objective."}
                  </div>
                </div>

                <div className="rounded-2xl border border-stone-900/10 bg-stone-900/5 p-4">
                  <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-stone-500">Estimated Impact</div>
                  <div className="text-sm text-stone-700">
                    {formatWatts(runEstimate.wattsSaved)} reduction • {formatCurrency(runEstimate.costSavedUsd)} this run
                  </div>
                  <div className="mt-1 text-sm text-stone-700">
                    Projection: {formatCurrency(monthlyTotals.costUsd)} / month • {formatKwh(monthlyTotals.energyKwh)}
                  </div>
                </div>

                <div className="rounded-2xl border border-stone-900/10 bg-stone-900/5 p-4">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-stone-500">Key Actions Taken</div>
                  {(agentRun?.selected_plan ?? []).length > 0 ? (
                    <ul className="space-y-1.5 text-sm text-stone-700">
                      {(agentRun?.selected_plan ?? []).slice(0, 3).map((action) => (
                        <li key={action.id} className="rounded-lg bg-stone-50 px-2.5 py-1.5">
                          {action.title}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm text-stone-500">No run yet.</div>
                  )}
                </div>

                <div className="rounded-2xl border border-stone-900/10 bg-stone-900/5 p-4">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-stone-500">Protected / Skipped</div>
                  <div className="text-sm text-stone-700">
                    Protected rooms: {(parsedIntent?.protected_rooms ?? []).length || 0}
                  </div>
                  <div className="text-sm text-stone-700">Skipped actions: {(agentRun?.skipped_actions ?? []).length || 0}</div>
                  {(parsedIntent?.protected_rooms ?? []).length > 0 ? (
                    <div className="mt-2 text-xs text-stone-500">{(parsedIntent?.protected_rooms ?? []).join(", ")}</div>
                  ) : null}
                </div>
              </div>

              <p className="mb-4 text-sm leading-6 text-stone-600">
                {agentRun?.reasoning_summary ??
                  "Detailed reasoning appears after a run, including tradeoffs between savings, comfort, and safety constraints."}
              </p>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="panel-title mb-2">Assumptions</div>
                  {(agentRun?.assumptions ?? []).length > 0 ? (
                    <ul className="space-y-2 text-sm text-stone-600">
                      {(agentRun?.assumptions ?? []).map((item) => (
                        <li key={item} className="rounded-2xl bg-stone-900/5 px-3 py-2">
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="rounded-2xl bg-stone-900/5 px-3 py-2 text-sm text-stone-500">No run yet.</div>
                  )}
                </div>

                <div>
                  <div className="panel-title mb-2">Constraints Applied</div>
                  {(agentRun?.constraints_applied ?? []).length > 0 ? (
                    <ul className="space-y-2 text-sm text-stone-600">
                      {(agentRun?.constraints_applied ?? []).map((item) => (
                        <li key={item} className="rounded-2xl bg-stone-900/5 px-3 py-2">
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="rounded-2xl bg-stone-900/5 px-3 py-2 text-sm text-stone-500">No run yet.</div>
                  )}
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Selected Actions"
              eyebrow="Execution Plan"
              subtitle="Ordered actions chosen by the optimizer with estimated power and value impact."
              className="border-l-2 border-l-accent/30"
            >
              {(agentRun?.selected_plan ?? []).length > 0 ? (
                <div className="space-y-3">
                  {(agentRun?.selected_plan ?? []).map((action, index) => {
                    const reached = index + 1 <= activeStep;
                    const savings = action.estimated_savings_watts;
                    const savingsCost =
                      savings > 0
                        ? wattsToKwh(savings, runEstimate.durationHours) * runEstimate.ratePerKwh
                        : 0;

                    return (
                      <div
                        key={action.id}
                        className={`rounded-2xl border px-4 py-3 transition ${
                          reached ? "border-accent/40 bg-accent/8" : "border-stone-900/10 bg-stone-900/5"
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-stone-900/10 text-xs font-semibold text-stone-700">
                              {index + 1}
                            </span>
                            <span className="font-medium text-stone-900">{action.title}</span>
                          </div>
                          <div className="text-right">
                            <span className={`text-sm font-semibold ${savings >= 0 ? "text-success" : "text-danger"}`}>
                              {savings >= 0 ? "-" : "+"}
                              {formatWatts(Math.abs(savings))}
                            </span>
                            <div className="text-xs text-stone-500">
                              {savings >= 0 ? formatCurrency(savingsCost) : formatCurrency(0)} value
                            </div>
                          </div>
                        </div>
                        <div className="text-sm text-stone-600">{action.description}</div>
                        <div className="mt-2 text-xs uppercase tracking-[0.16em] text-stone-400">{action.reason}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-stone-900/10 bg-stone-900/5 px-4 py-3 text-sm text-stone-500">
                  No plan yet. Run the optimizer to populate this section.
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Skipped Actions"
              eyebrow="Safety Holds"
              subtitle="Actions intentionally blocked by hard constraints or scope limits."
            >
              {(agentRun?.skipped_actions ?? []).length > 0 ? (
                <div className="space-y-3">
                  {(agentRun?.skipped_actions ?? []).map((item) => (
                    <div key={item.device_id} className="rounded-2xl border border-accentWarm/25 bg-accentWarm/10 px-4 py-3">
                      <div className="font-medium text-stone-900">{item.title}</div>
                      <div className="text-sm text-stone-600">{item.reason}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-stone-900/10 bg-stone-900/5 px-4 py-3 text-sm text-stone-500">
                  No skipped actions for this run.
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Execution Timeline"
              eyebrow="Run Log"
              subtitle="Per-step execution output tied to the snapshot currently shown in the simulation."
            >
              {(agentRun?.execution_results ?? []).length > 0 ? (
                <div className="space-y-3">
                  {(agentRun?.execution_results ?? []).map((item, index) => {
                    const reached = index + 1 <= activeStep;

                    return (
                      <div
                        key={item.action_id}
                        className={`rounded-2xl border px-4 py-3 text-sm transition ${
                          reached
                            ? "border-accent/20 bg-accent/10 text-stone-800"
                            : "border-stone-900/10 bg-stone-900/5 text-stone-500"
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between gap-4">
                          <span className="font-medium">{item.title}</span>
                          <span>{formatWatts(item.resulting_power_watts)}</span>
                        </div>
                        <div>{item.message}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-stone-900/10 bg-stone-900/5 px-4 py-3 text-sm text-stone-500">
                  Timeline appears after the first run.
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      </div>

      <MonthlySavingsModal
        open={isMonthlySavingsOpen}
        onClose={() => setIsMonthlySavingsOpen(false)}
        view={monthlyView}
        onViewChange={setMonthlyView}
        points={monthlyPoints}
        totals={monthlyTotals}
        breakdown={monthBreakdown}
        thisMonthRuns={thisMonthRuns}
        averageRatePerKwh={averageMonthRatePerKwh}
        isUsingSeededData={!hasRecentHistory}
      />
    </div>
  );
}

export default App;
