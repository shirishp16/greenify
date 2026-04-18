import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { getHomeState, planAndExecute, toggleDevice } from "./api";
import { HouseScene } from "./components/HouseScene";
import { SectionCard } from "./components/SectionCard";
import type { AgentResponse, HomeState } from "./types";
import { formatWatts, toTitleCase } from "./utils";

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
  const parsedIntent = agentRun?.parsed_intent;
  const stepTotal = agentRun?.selected_plan.length ?? 0;
  const stepsCompleted = Math.min(activeStep, stepTotal);
  const progressPercent = stepTotal > 0 ? Math.round((stepsCompleted / stepTotal) * 100) : 0;

  const plannerText = agentRun
    ? agentRun.planner === "llm"
      ? "OpenAI Planner"
      : "Rules Fallback"
    : "Idle";

  const workflowStatus = isLoading ? "Loading home state" : isRunning ? "Executing plan" : agentRun ? "Run complete" : "Ready";

  const topMetrics = [
    {
      label: "Occupancy",
      value: toTitleCase(modeSource?.occupancy ?? "home"),
    },
    {
      label: "Pricing Signal",
      value: modeSource?.peak_pricing ? "Active" : "Off",
    },
    {
      label: "Outdoor Temp",
      value: `${modeSource?.outdoor_temp_f ?? "--"}°F`,
    },
    {
      label: "Live Load",
      value: formatWatts(displayedState?.total_power_watts ?? 0),
    },
    {
      label: "Planner",
      value: plannerText,
    },
  ];

  return (
    <div className="app-shell min-h-screen px-4 py-6 text-stone-800 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1700px]">
        <motion.header
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]"
        >
          <div className="panel p-6 sm:p-7">
            <div className="mb-3 inline-flex rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.26em] text-accent">
              Greenify Control Center
            </div>
            <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl lg:text-5xl">
              Translate plain-English goals into safe, visible home energy actions.
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-600 sm:text-base">
              The left side is your command workspace and simulation. The right side is the decision console that explains
              what the agent planned, what it skipped, and why.
            </p>
          </div>

          <div className="panel p-6 sm:p-7">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-accent">Run Status</div>
            <div className="mb-2 text-2xl font-semibold text-stone-900">{workflowStatus}</div>
            <div className="mb-4 text-sm text-stone-600">{activeStepLabel}</div>
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
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-stone-900/5 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-stone-500">Before</div>
                <div className="text-lg font-semibold text-stone-900">
                  {formatWatts(agentRun?.watts_before ?? serverState?.total_power_watts ?? 0)}
                </div>
              </div>
              <div className="rounded-2xl bg-stone-900/5 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-stone-500">After</div>
                <div className="text-lg font-semibold text-stone-900">
                  {formatWatts(agentRun?.watts_after ?? displayedState?.total_power_watts ?? 0)}
                </div>
              </div>
              <div className="rounded-2xl border border-success/30 bg-success/10 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-success">Saved</div>
                <div className="text-lg font-semibold text-stone-900">{formatWatts(agentRun?.watts_saved ?? 0)}</div>
              </div>
            </div>
          </div>
        </motion.header>

        <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {topMetrics.map((item) => (
            <div key={item.label} className="kpi-card">
              <div className="text-[11px] uppercase tracking-[0.2em] text-stone-500">{item.label}</div>
              <div className="mt-2 text-base font-semibold text-stone-900">{item.value}</div>
            </div>
          ))}
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
          <div className="space-y-6">
            <SectionCard
              title="1. Define The Goal"
              eyebrow="Workflow"
              subtitle="Tell the agent what outcome you want. It will infer context and constraints automatically."
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
                {isRunning ? "Executing Plan..." : "Run Agent"}
              </button>

              {error ? (
                <p className="mt-3 rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
              ) : null}
            </SectionCard>

            <SectionCard
              title="2. Watch The Home Simulation"
              eyebrow="Simulation"
              subtitle="The house scene replays backend snapshots in execution order. No UI-only state changes are injected."
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
                  <div className="mb-1 text-xs uppercase tracking-[0.18em] text-stone-500">Timeline</div>
                  Current step label maps directly to the backend execution snapshot.
                </div>
              </div>
            </SectionCard>

          </div>

          <div className="space-y-6">
            <SectionCard
              title="Agent Decision Console"
              eyebrow="Interpretation"
              subtitle="This explains how the goal was interpreted, what assumptions were made, and which constraints shaped the plan."
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
                  Planner: {plannerText}
                </span>
                {agentRun?.planner_notice ? <span className="text-xs text-stone-500">{agentRun.planner_notice}</span> : null}
              </div>

              <div className="mb-4 rounded-2xl border border-accent/20 bg-accent/10 p-4 text-sm text-stone-800">
                {agentRun?.interpreted_goal ?? "Run the agent to see how the prompt is interpreted into a planning objective."}
              </div>

              <p className="mb-4 text-sm leading-6 text-stone-600">
                {agentRun?.reasoning_summary ??
                  "Reasoning summary appears here after a run, including tradeoffs between savings, comfort, and safety constraints."}
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
              subtitle="Ordered actions the agent chose. Savings are estimated per action from state deltas."
              className="border-l-2 border-l-accent/30"
            >
              {(agentRun?.selected_plan ?? []).length > 0 ? (
                <div className="space-y-3">
                  {(agentRun?.selected_plan ?? []).map((action, index) => {
                    const reached = index + 1 <= activeStep;
                    const savings = action.estimated_savings_watts;

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
                          <span className={`text-sm font-semibold ${savings >= 0 ? "text-success" : "text-danger"}`}>
                            {savings >= 0 ? "-" : "+"}
                            {formatWatts(Math.abs(savings))}
                          </span>
                        </div>
                        <div className="text-sm text-stone-600">{action.description}</div>
                        <div className="mt-2 text-xs uppercase tracking-[0.16em] text-stone-400">{action.reason}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-stone-900/10 bg-stone-900/5 px-4 py-3 text-sm text-stone-500">
                  No plan yet. Run the agent to populate this section.
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Skipped Actions"
              eyebrow="Safety Holds"
              subtitle="Actions intentionally blocked by hard constraints or scope limitations."
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
    </div>
  );
}

export default App;
