import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { getHomeState, planAndExecute, resetScenario } from "./api";
import { HouseScene } from "./components/HouseScene";
import { SectionCard } from "./components/SectionCard";
import { scenarioPresets } from "./data/scenarios";
import type { AgentResponse, HomeState, ScenarioId } from "./types";
import { formatClock, formatWatts, toTitleCase } from "./utils";

function App() {
  const [goal, setGoal] = useState(scenarioPresets[0].goal);
  const [scenarioId, setScenarioId] = useState<ScenarioId>("away_mode");
  const [displayedState, setDisplayedState] = useState<HomeState | null>(null);
  const [serverState, setServerState] = useState<HomeState | null>(null);
  const [agentRun, setAgentRun] = useState<AgentResponse | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [activeStepLabel, setActiveStepLabel] = useState("Ready");
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playbackVersion = useRef(0);

  useEffect(() => {
    void loadInitialState();
  }, []);

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

  async function handleScenarioReset(nextScenarioId: ScenarioId) {
    playbackVersion.current += 1;
    setIsRunning(false);
    setScenarioId(nextScenarioId);
    const preset = scenarioPresets.find((item) => item.id === nextScenarioId);
    if (preset) {
      setGoal(preset.goal);
    }

    try {
      setIsLoading(true);
      const homeState = await resetScenario(nextScenarioId);
      setDisplayedState(homeState);
      setServerState(homeState);
      setAgentRun(null);
      setActiveStep(0);
      setActiveStepLabel("Scenario reset");
      setError(null);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Failed to reset scenario.");
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

  async function handleRunAgent() {
    try {
      setError(null);
      setIsRunning(true);
      const response = await planAndExecute(goal);
      setAgentRun(response);
      await playback(response);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Agent execution failed.");
      setIsRunning(false);
    }
  }

  const modeSource = displayedState ?? serverState;

  return (
    <div className="min-h-screen px-4 py-6 text-stone-800 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px]">
        <motion.header
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
        >
          <div>
            <div className="mb-2 text-sm uppercase tracking-[0.35em] text-accent">Greenify</div>
            <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl">
              AI-powered energy agent — turns intent into autonomous home savings.
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="data-pill">Occupancy: {toTitleCase(modeSource?.occupancy ?? "home")}</span>
            <span className="data-pill">Peak pricing: {modeSource?.peak_pricing ? "Active" : "Off"}</span>
            <span className="data-pill">Outdoor: {modeSource?.outdoor_temp_f ?? "--"}°F</span>
            <span className="data-pill border-accent/25 text-accent">{formatWatts(displayedState?.total_power_watts ?? 0)} live</span>
          </div>
        </motion.header>

        <div className="grid gap-6 xl:grid-cols-[1.45fr_0.95fr]">
          <div className="space-y-6">
            <HouseScene homeState={displayedState} activeStepLabel={isLoading ? "Loading" : activeStepLabel} />

            <div className="grid gap-6 lg:grid-cols-3">
              <SectionCard title="Scenario Controls" eyebrow="Input">
                <div className="mb-4 flex flex-wrap gap-2">
                  {scenarioPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => void handleScenarioReset(preset.id)}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                        scenarioId === preset.id
                          ? "bg-accent text-white"
                          : "border border-stone-900/15 bg-stone-900/5 text-stone-700 hover:bg-stone-900/10"
                      }`}
                      disabled={isLoading || isRunning}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={goal}
                  onChange={(event) => setGoal(event.target.value)}
                  rows={5}
                  className="mb-4 w-full rounded-2xl border border-stone-900/10 bg-stone-50/90 p-4 text-sm text-stone-800 outline-none transition focus:border-accent/40 focus:ring-2 focus:ring-accent/15 placeholder:text-stone-400"
                  placeholder="Describe the outcome you want."
                />
                <button
                  type="button"
                  onClick={() => void handleRunAgent()}
                  disabled={isLoading || isRunning || !goal.trim()}
                  className="w-full rounded-2xl bg-gradient-to-r from-accent to-green-500 px-4 py-3 text-sm font-semibold text-white ring-1 ring-accent/30 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRunning ? "Executing plan..." : "Run Agent"}
                </button>
                {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
              </SectionCard>

              <SectionCard title="Mode Signals" eyebrow="State">
                <div className="space-y-3 text-sm text-stone-700">
                  <div className="flex items-center justify-between rounded-2xl bg-stone-900/5 px-4 py-3">
                    <span>Mode</span>
                    <span className="font-medium text-stone-900">{modeSource?.mode_label ?? "--"}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-stone-900/5 px-4 py-3">
                    <span>Current time</span>
                    <span className="font-medium text-stone-900">{formatClock(modeSource?.current_time ?? null)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-stone-900/5 px-4 py-3">
                    <span>Return time</span>
                    <span className="font-medium text-stone-900">{formatClock(modeSource?.return_time ?? null)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-stone-900/5 px-4 py-3">
                    <span>Comfort band</span>
                    <span className="font-medium text-stone-900">
                      {modeSource ? `${modeSource.comfort_temp_range.min_f}°F - ${modeSource.comfort_temp_range.max_f}°F` : "--"}
                    </span>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Energy Delta" eyebrow="Impact">
                <div className="space-y-3">
                  <div className="rounded-2xl bg-stone-900/5 p-4">
                    <div className="mb-1 text-xs uppercase tracking-[0.22em] text-stone-500">Before</div>
                    <div className="text-3xl font-semibold text-stone-900">{formatWatts(agentRun?.watts_before ?? serverState?.total_power_watts ?? 0)}</div>
                  </div>
                  <div className="rounded-2xl bg-stone-900/5 p-4">
                    <div className="mb-1 text-xs uppercase tracking-[0.22em] text-stone-500">After</div>
                    <div className="text-3xl font-semibold text-stone-900">{formatWatts(agentRun?.watts_after ?? displayedState?.total_power_watts ?? 0)}</div>
                  </div>
                  <div className="rounded-2xl border border-success/30 bg-success/10 p-4">
                    <div className="mb-1 text-xs uppercase tracking-[0.22em] text-success">Saved</div>
                    <div className="text-3xl font-semibold text-stone-900">{formatWatts(agentRun?.watts_saved ?? 0)}</div>
                  </div>
                </div>
              </SectionCard>
            </div>
          </div>

          <div className="space-y-6">
            <SectionCard title="Agent Reasoning" eyebrow="Interpretation" className="border-l-2 border-l-accent/30">
              {agentRun ? (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span
                    className={`data-pill ${
                      agentRun.planner === "llm"
                        ? "border-accent/30 bg-accent/15 text-accent"
                        : "border-danger/30 bg-danger/15 text-danger"
                    }`}
                  >
                    {agentRun.planner === "llm" ? "Planner: OpenAI (live)" : "Planner: Emergency fallback"}
                  </span>
                  {agentRun.planner_notice ? (
                    <span className="text-xs text-stone-500">{agentRun.planner_notice}</span>
                  ) : null}
                </div>
              ) : null}
              <div className="mb-4 rounded-2xl border border-accent/20 bg-accent/10 p-4 text-sm text-stone-800">
                {agentRun?.interpreted_goal ?? "Run a scenario to see how Greenify interprets and executes the goal."}
              </div>
              <p className="mb-4 text-sm leading-6 text-stone-600">
                {agentRun?.reasoning_summary ??
                  "The agent will inspect home state, preserve essential/security devices, and sequence the highest-value energy actions first."}
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="panel-title mb-2">Assumptions</div>
                  <ul className="space-y-2 text-sm text-stone-600">
                    {(agentRun?.assumptions ?? []).map((item) => (
                      <li key={item} className="rounded-2xl bg-stone-900/5 px-3 py-2">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="panel-title mb-2">Constraints</div>
                  <ul className="space-y-2 text-sm text-stone-600">
                    {(agentRun?.constraints_applied ?? []).map((item) => (
                      <li key={item} className="rounded-2xl bg-stone-900/5 px-3 py-2">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Selected Plan" eyebrow="Execution" className="border-l-2 border-l-accent/30">
              <div className="space-y-3">
                {(agentRun?.selected_plan ?? []).map((action, index) => {
                  const isActive = index + 1 <= activeStep;
                  return (
                    <div
                      key={action.id}
                      className={`rounded-2xl border px-4 py-3 transition ${
                        isActive ? "border-accent/40 bg-accent/8" : "border-stone-900/10 bg-stone-900/5"
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-4">
                        <div className="font-medium text-stone-900">{action.title}</div>
                        <div className="text-sm text-accentWarm">-{formatWatts(action.estimated_savings_watts)}</div>
                      </div>
                      <div className="text-sm text-stone-600">{action.description}</div>
                      <div className="mt-2 text-xs uppercase tracking-[0.18em] text-stone-400">{action.reason}</div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            <SectionCard title="Skipped by Constraints" eyebrow="No Action">
              <div className="space-y-3">
                {(agentRun?.skipped_actions ?? []).map((item) => (
                  <div key={item.device_id} className="rounded-2xl border border-accentWarm/20 bg-accentWarm/8 px-4 py-3">
                    <div className="font-medium text-stone-900">{item.title}</div>
                    <div className="text-sm text-stone-600">{item.reason}</div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Execution Log" eyebrow="Timeline">
              <div className="space-y-3">
                {(agentRun?.execution_results ?? []).map((item, index) => {
                  const reached = index + 1 <= activeStep;
                  return (
                    <div
                      key={item.action_id}
                      className={`rounded-2xl px-4 py-3 text-sm transition ${
                        reached ? "bg-accent/10 text-stone-800" : "bg-stone-900/5 text-stone-400"
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
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
