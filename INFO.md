# Greenify — Project Reference

One-stop reference for engineers and marketing. Covers the end-to-end runtime, data model, and the design system (colors, typography, UI primitives) used across the product. If you need to demo the product, extend a feature, or produce on-brand marketing collateral, everything you need is here.

For pure run instructions, see [README.md](README.md). For Claude-Code-session-specific guardrails, see [CLAUDE.md](CLAUDE.md) (gitignored).

---

## 1. Product Overview

Greenify is an AI-powered home energy agent. A resident types a plain-English goal ("I'm leaving for three hours, keep the house secure"), an OpenAI planning model selects a safe, explainable set of device actions, the backend executes those actions against a simulated home, and a 3D dollhouse on the dashboard animates the resulting state changes in real time. Every number the user sees (watts before, watts after, savings) is recomputed from actual state, not guessed by the LLM.

**Audience:** hackathon judges, investor/demo viewers, and marketing content (screenshots, explainer videos, one-pagers).

**What's differentiating:**
- LLM-as-planner, not LLM-as-executor — the model picks from a pre-validated candidate set, so every action is safe by construction.
- Every run is visible: 3D scene animates snapshot-by-snapshot in the exact order the backend applied them.
- Honest fallback: when the LLM is unreachable or returns bad JSON, the UI says "Rules Fallback" in plain English instead of pretending the AI ran.

---

## 2. End-to-End Request Flow

### Primary flow: goal → animated plan

```
1. User types goal in textarea                       (frontend: App.tsx)
2. POST /api/agent/plan-and-execute                  (frontend: api.ts — body: {goal, chat_history})
3. build_home_state_from_goal(goal)                  (backend: state.py picks scenario by keywords)
4. EnergyAgent.plan_and_execute(state, goal, chat_history):
      ├─ _parse_direct_command(goal)                 (fast-path for "turn on bedroom lamp" — skips LLM)
      ├─ _compose_goal_with_history(goal, chat)      (prepends last-N user+assistant turns)
      ├─ parse_goal(composed, state) → GoalIntent    (phrase matching, protected rooms, scope)
      ├─ plan_with_llm(state, goal, chat_history)    (llm_planner.py — chat.completions + JSON mode)
      │     ├─ _build_user_prompt(state, goal, hist) (full home state JSON + chat replay)
      │     ├─ OpenAI returns LLMPlan JSON           (actions + reasoning + assumptions + skipped)
      │     └─ LLMPlan.model_validate(payload)       (Pydantic enforces shape)
      ├─ ┬  on success:
      │ ├─ _convert_llm_plan(state, plan):           (validates each action against the device)
      │ │      ├─ drop unknown device_ids
      │ │      ├─ drop non-remote-controllable
      │ │      ├─ drop is_on=false on essential devices
      │ │      ├─ drop per-action-type invariant violations
      │ │      └─ rejected → skipped_actions w/ reason
      │ └─ re-sort by LLM-assigned priority
      ├─ ┴  on failure (no key, bad JSON, schema mismatch, unsupported action_type):
      │      └─ rules fallback: _candidate_actions + _prioritize
      │            (planner="rules", planner_notice explains why)
      └─ execution loop (shared across both paths):
            ├─ if device.real_device and is_on changes → smart_plug_service.set_power(id, bool)
            ├─ _apply_action()                        (deep-copy state, overwrite device.state)
            ├─ with_total_power()                     (recompute watts from compute_device_draw)
            ├─ append HomeStateSnapshot               (one per step)
            └─ append ExecutionResult
5. AgentResponse returned                            (initial_state, snapshots[], final_state,
                                                      watts_before/after/saved, planner, notice)
6. home_state_store.set_state(final)                 (persists across requests until restart)
7. Frontend playback(response):                      (App.tsx)
      ├─ setDisplayedState(initial_state)
      ├─ walk snapshots: 600ms step 0, 1100ms per subsequent
      ├─ playbackVersion ref cancels stale loops on re-run or direct toggle
      └─ finalize setServerState(final_state)
8. HouseScene re-renders on every setDisplayedState
      └─ devices.tsx lerps light intensity / emissive / fan RPM toward target
9. Savings persistence:                              (App.tsx)
      ├─ appendSavingsRecord(history, createSavingsRunRecord(response))
      └─ localStorage "greenify.savings_history.v1" (cap 500 records)
10. Conversation memory:                             (App.tsx)
      ├─ append user turn + assistant summary
      └─ localStorage "greenify.chat_log.v1"         (cap 80 msgs; last 16 sent on next run)
```

### Secondary flow: direct device control

```
1. User clicks a device mesh                  (frontend: HouseScene)
2. POST /api/device/{id}/toggle               (frontend: api.ts)
3. routes.py: toggle_device                   (flips is_on, derives brightness/screen/rpm/charger_status)
4. If device.real_device → smart_plug_service.set_power(id, bool)
5. home_state_store.set_state(updated)
6. HomeState returned → displayedState replaced immediately (no snapshot loop)
```

### Persistence

`HomeStateStore` is an in-memory singleton in `backend/app/core/state.py`. Server restart → state resets to the `away_mode` default. Acceptable for a demo; noted as technical debt.

---

## 3. Repository Layout

```
greenify/
├── README.md                          # Quick start + product blurb
├── INFO.md                            # ← this file (checked in)
├── CLAUDE.md                          # Claude Code session guide (gitignored)
├── Makefile                           # Convenience targets
├── backend/
│   ├── requirements.txt               # fastapi, uvicorn, pydantic, openai>=1.40, python-dotenv
│   ├── .env / .env.example            # OPENAI_API_KEY, OPENAI_MODEL, etc.
│   ├── app/
│   │   ├── main.py                    # FastAPI app — load_dotenv() MUST stay before route imports
│   │   ├── api/
│   │   │   ├── routes.py              # 4 demo endpoints (see §4)
│   │   │   └── igs.py                 # /igs/* grid-services router (home-profile, optimization-result, event-response)
│   │   ├── core/
│   │   │   ├── agent.py               # EnergyAgent — direct-command fast-path + LLM dispatch + rules fallback + executor
│   │   │   ├── state.py               # HomeStateStore, _base_devices (14), scenario builders, build_home_state_from_goal
│   │   │   ├── settings.py            # Frozen dataclass reading OpenAI env vars
│   │   │   └── llm_planner.py         # PRIMARY LLM path — chat.completions + JSON object mode + LLMPlan Pydantic schema
│   │   ├── services/
│   │   │   ├── openai_agent.py        # OpenAIPlanner class (Responses API + strict JSON schema) — instantiated by agent but NOT on the plan_and_execute path; kept for reference / future reintroduction
│   │   │   └── smart_plug.py          # Real/mock smart-plug adapter (Apple Shortcuts + Home Assistant)
│   │   └── models/schemas.py          # All Pydantic models + SUPPORTED_ACTION_TYPES set
│   └── tests/                         # test_agent.py (minimal coverage)
└── frontend/
    ├── index.html                     # Bare shell — no Google Fonts link (known gap, §6)
    ├── vite.config.ts                 # Vite + React + TS
    ├── tailwind.config.cjs            # Color tokens + shadow-glow + font stack
    ├── postcss.config.cjs
    ├── package.json                   # React 19, Vite, Tailwind 3, @react-three/fiber, drei, framer-motion
    └── src/
        ├── main.tsx                   # ReactDOM StrictMode root
        ├── App.tsx                    # Dashboard — page composition, playback loop, chat log, savings history
        ├── api.ts                     # getHomeState, planAndExecute(goal, chat_history), toggleDevice
        ├── types.ts                   # TS mirror of Pydantic schemas + ChatLogMessage
        ├── utils.ts                   # formatClock, formatWatts, toTitleCase
        ├── savings.ts                 # Savings math — wattsToKwh, electricity rate, monthly series, category breakdown, CO₂, localStorage persistence
        ├── index.css                  # Global gradients + .panel/.panel-title/.data-pill/.kpi-card/.input-surface
        └── components/
            ├── SectionCard.tsx        # Titled card (eyebrow + accent separator)
            ├── HouseScene.tsx         # Canvas, camera, lights, OrbitControls, findDevice lookups (12 bindings — no fridge mesh)
            ├── MonthlySavingsModal.tsx # 30-day trend modal (cost/energy toggle, category breakdown, CO₂)
            ├── SavingsTrendChart.tsx   # SVG line chart used inside the modal
            └── house/
                ├── RoomShell.tsx      # Box-geometry room + floating label
                └── devices.tsx        # Device components + lerp hooks (incl. HVACUnit)
```

---

## 4. Backend Deep Dive

### 4.1 API Contract

Four demo endpoints under `/api/*`, mounted in `main.py`:

| Method | Path | Request | Response | Side effects |
|---|---|---|---|---|
| GET | `/api/health` | — | `{"status":"ok"}` | None |
| GET | `/api/home-state` | — | `HomeState` | None |
| POST | `/api/agent/plan-and-execute` | `{"goal": str, "chat_history": ChatLogMessage[]}` | `AgentResponse` | Rebuilds scenario from goal, runs LLM plan, persists `final_state` to store |
| POST | `/api/device/{device_id}/toggle` | — | `HomeState` | Flips `is_on`, derives companion fields, calls real smart plug if `real_device` |

A second router `/igs/*` is mounted from [backend/app/api/igs.py](backend/app/api/igs.py) for grid-services integration — `POST /igs/home-profile`, `POST /igs/optimization-result`, `POST /igs/event-response`. These are not consumed by the current frontend.

### 4.2 OpenAI Integration (primary path — `llm_planner.py:plan_with_llm`)

- **SDK call:** `client.chat.completions.create(...)` with `response_format={"type":"json_object"}`. **Not** the Responses API — that code path lives in `services/openai_agent.py` (`OpenAIPlanner.plan`, still present for reference) but is not wired into `plan_and_execute`.
- **Model:** `OPENAI_MODEL` env (default `gpt-4o-mini`). Any chat-completion-capable model that supports JSON-object mode works.
- **Inputs given to model:**
  - `SYSTEM_PROMPT` — the closed action vocabulary, per-type `target_state` contracts, worked examples, hard-constraint checklist.
  - User message built by `_build_user_prompt(home_state, goal, chat_history)` — full home state JSON (occupancy, time, peak pricing, outdoor temp, comfort band, every device with flags and current state) plus the serialized chat replay.
- **Output contract (`LLMPlan`, validated via Pydantic `model_validate`):**
  - `interpreted_goal: str`
  - `reasoning_summary: str`
  - `assumptions: list[str]`
  - `constraints_applied: list[str]`
  - `plan: list[LLMPlanAction]` — each with `device_id`, `action_type`, complete `target_state`, `priority`, `estimated_savings_watts`, `title`, `description`, `reason`
  - `skipped: list[LLMSkipped]` — model's own self-reported skips with reasons
- **Key insight — LLM writes target_state directly, backend validates:** the LLM is *not* constrained to pick from a pre-computed candidate set. It writes complete `DeviceState` objects, and `_convert_llm_plan` in `agent.py` runs every action through `_validate_action_against_device` before execution. Invalid actions land in `skipped_actions` with a concrete reason string. The LLM is not re-called.
- **Failure modes (all return `(None, notice_string)` from `plan_with_llm`, caught by agent → rules fallback):**
  - `OPENAI_API_KEY` not set
  - `openai` package not importable
  - Any exception from `client.chat.completions.create` (network, timeout, rate limit, auth, server error — caught as broad `Exception`)
  - Empty or non-JSON content
  - Payload fails `LLMPlan` schema validation
  - Any `action_type` not in `SUPPORTED_ACTION_TYPES`

### 4.3 Rules Fallback and Direct-Command Fast-Path

Two non-LLM paths live alongside the primary LLM flow:

**Direct-command fast-path** (`_parse_direct_command` in `agent.py:1109`): imperative prompts like *"turn on the bedroom lamp"* or *"turn off the TV"* are detected by phrase matching, resolved to a single device, and executed without calling the LLM at all. Returns `planner="rules"` with notice *"Direct command — agent used the set_device_power tool immediately."*

**Rules planner** (`_candidate_actions` + `_prioritize`): when `plan_with_llm` returns `None`, the agent composes a `GoalIntent` from the goal text (with recent chat history prepended via `_compose_goal_with_history`) and generates candidate actions deterministically:

- `ROOM_ALIASES` — maps rooms to aliases ("office" → `["office","desk","study"]`, etc.).
- `_goal_implies_room_presence(goal, aliases, activity)` — matches >50 phrase patterns like *"working in the bedroom"*, *"keep the kitchen on"*, *"except the office"*.
- Response shape matches the LLM path (`AgentResponse` is identical), but `planner="rules"` and `planner_notice` explains the fallback reason (e.g., *"OPENAI_API_KEY not set — running emergency rules fallback"*, *"LLM response was not valid JSON — running emergency rules fallback"*).

The rules engine only covers `turn_off`, `fan_slow`/`fan_off`, and `pause_charging`; the richer action verbs (`set_brightness`, `resume_charging`) are LLM-only.

### 4.4 Device Catalog (14 devices, defined in `state.py:_base_devices()`)

| device_id | type | room | watts | essential | security | comfort | real_device | can_defer |
|---|---|---|---|---|---|---|---|---|
| `living_room_lamp` | light | living room | 60 | — | — | ✓ | — | — |
| `living_room_tv` | screen | living room | 120 | — | — | — | — | — |
| `kitchen_ceiling_light` | light | kitchen | 45 | — | — | — | — | — |
| `kitchen_fridge` | fridge | kitchen | 180 | ✓ | — | — | — | — |
| `kitchen_dishwasher` | appliance | kitchen | 1200 | — | — | — | — | ✓ |
| `bedroom_lamp` | light | bedroom | 35 | — | — | ✓ | — | — |
| `bedroom_fan` | fan | bedroom | 70 | — | — | ✓ | — | — |
| `central_hvac` | **hvac** | system | 3500 | — | — | ✓ | — | — |
| `office_monitor` | screen | office | 95 | — | — | — | — | — |
| `office_demo_plug_lamp` | smart_plug | office | 50 | — | — | — | ✓ | — |
| `garage_ev_charger` | ev_charger | garage | 7200 | — | — | — | — | ✓ |
| `porch_light` | light | exterior | 18 | — | ✓ | — | — | — |
| `laundry_washer` | appliance | laundry | 500 | — | — | — | — | ✓ |
| `laundry_dryer` | appliance | laundry | 5000 | — | — | — | — | ✓ |

`kitchen_fridge` has no 3D mesh binding — it contributes to wattage math but doesn't appear in the scene. `central_hvac` is pseudo-located in a `"system"` room (not a physical RoomShell) and rendered as a standalone exterior unit next to the house.

### 4.4.1 HVAC (whole-home comfort system)

HVAC is modeled as a single device (`central_hvac`, type `DeviceType.HVAC`, 3500W) that the planner treats as a whole-home comfort system rather than a per-room appliance. Decision logic lives in `EnergyAgent` in `agent.py`:

- **`_hvac_needs_climate_support(home_state)`** — true when `outdoor_temp_f` is more than **2°F outside** the comfort band (above `max_f + 2` or below `min_f - 2`). If false, HVAC defaults to OFF.
- **`_hvac_is_extreme_weather(home_state)`** — true when outdoor temp is more than **8°F outside** the comfort band. Forces HVAC ON regardless of cost-sensitive prompts; acts as an override for the "away + not preserve_comfort" off path.
- **`_desired_hvac_state(device, intent, home_state)`** returns a target `DeviceState` using this precedence:
  1. No climate support needed → OFF.
  2. `away_mode` + `preserve_comfort=false` + not extreme → OFF.
  3. `preserve_comfort` OR protected rooms OR occupancy=home OR extreme weather → ON (clears any `scheduled` flag).
  4. `cost_sensitive` + no protected rooms + not extreme → OFF.
  5. Otherwise → no action (skip).

The rules-fallback executor produces a `turn_on` action titled **"Run Central HVAC"** (priority 1) or a `turn_off` action titled **"Pause Central HVAC"** depending on `target.is_on`. The reasoning strings reference the outdoor temperature vs. comfort band rather than a fixed mode.

The LLM path is steered by two prompt additions:
- In `llm_planner.py` SYSTEM_PROMPT: *"Treat hvac as a whole-home comfort system. When outdoor temperature is outside the comfort band, prefer it ON unless the prompt is explicitly cost-sensitive or the resident is away and comfort is not being preserved."*
- In `openai_agent.py` instructions: *"Use whole-home HVAC when weather materially exceeds the comfort band, and reduce it only when the prompt clearly allows comfort tradeoffs."*

The closed action vocabulary now documents HVAC under both `turn_on` and `turn_off` (see §4.5). No HVAC-specific action type was added — the existing on/off verbs cover it.

**Goal-scope keyword expansion**: `_goal_to_action_scope` detects HVAC-scoped prompts when any of these tokens appear in the goal: `hvac`, `ac`, `a/c`, `air conditioning`, `heat`, `heating`, `cooling`, `thermostat`.

**Scenario seeding**: `peak_pricing` now flips `central_hvac.is_on = True` at scenario build time so demos that trigger peak pricing start with HVAC already running (lets the agent demonstrate pausing HVAC for cost savings).

**New constraint string** added to every rules-path response: *"Whole-home HVAC responds to outdoor temperature and the comfort band."*

### 4.5 Action Vocabulary (closed set — `SUPPORTED_ACTION_TYPES`)

| action_type | Applies to | `target_state` requirements |
|---|---|---|
| `turn_off` | light, screen, fan, smart_plug, appliance, ev_charger, **hvac** | `is_on=false`; lights: `brightness=0`; screens: `screen_on=false`; fans: `rotation_rpm=0`; use `pause_charging` for EV; hvac: just `is_on=false` |
| `turn_on` | light, screen, fan, smart_plug, appliance, **hvac** | `is_on=true`; lights/plugs: `brightness ∈ (0, 1]`; fans: `rotation_rpm > 0`; screens: `screen_on=true`; appliances + hvac: companion fields = null |
| `screen_off` | screen only | `is_on=false, screen_on=false` |
| `set_brightness` | light, smart_plug | `is_on=true`, `brightness ∈ (0, 1]` |
| `set_fan_speed` | fan | `rotation_rpm ≥ 0`; rpm=0 → `is_on=false`; rpm>0 → `is_on=true`; typical comfort band 60–240 |
| `pause_charging` | ev_charger | `is_on=false, charger_status="paused", scheduled=true` |
| `resume_charging` | ev_charger | `is_on=true, charger_status="charging", scheduled=false` |

The executor (`_apply_action`) copies `target_state` wholesale. The `action_type` label drives validation, UI display, and LLM prompt guidance.

### 4.6 Scenarios (built by `state.py:build_home_state(scenario_id)`)

All three scenarios now carry `mode_label="Prompt Driven"` — the UI no longer surfaces scenario names because the planner is intent-driven. Named scenarios still seed different initial conditions though.

| scenario | occupancy | peak pricing | outdoor °F | comfort band | notable |
|---|---|---|---|---|---|
| `away_mode` | away | false | 72 | 67–75 | Default on server boot. HVAC off (outdoor in band). |
| `peak_pricing` | home | true | 83 | 68–76 | Outdoor is +7°F above band → HVAC seeded ON; demo-primes an HVAC pause action. |
| `sleep_mode` | home | false | 66 | 65–73 | Bedroom lamp at 0.45, fan at 120 rpm. HVAC off (in band). |

`build_home_state_from_goal(goal)` picks a scenario by keyword (e.g., "sleep", "peak", "leaving") per request, so the state reflects intent without requiring a separate reset call.

### 4.7 Environment

Loaded via `python-dotenv` in `main.py` before the routes module imports. Critical to not reorder.

| Var | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | Required for the LLM path |
| `OPENAI_MODEL` | `gpt-4o-mini` | Any chat-completion model supporting JSON-object mode |
| `GREENIFY_ENV` | `development` | Environment tag |
| `HOST` / `PORT` | `0.0.0.0` / `8000` | Uvicorn |
| `REAL_SMART_PLUG_ENABLED` | `false` | Toggles mock → real smart plug |
| `REAL_SMART_PLUG_API_KEY` | — | Vendor credential (only used when real adapter enabled) |
| `APPLE_SHORTCUT_<DEVICE_ID>_ON/_OFF` | — | Apple Shortcuts adapter names (macOS demo; highest priority) |
| `HA_BASE_URL`, `HA_TOKEN`, `HA_ENTITY_ID_<DEVICE_ID>` | — | Home Assistant + Matter adapter (Linux) |
| `VITE_API_URL` | `http://localhost:8000` | Frontend → backend base URL (client-side) |

---

## 5. Frontend Deep Dive

### 5.1 State Model (`App.tsx`)

| State | Purpose |
|---|---|
| `displayedState: HomeState \| null` | 3D scene's source of truth during playback |
| `serverState: HomeState \| null` | Authoritative state after a run completes |
| `agentRun: AgentResponse \| null` | Full response populates all side panels |
| `activeStep: number` | Current snapshot index |
| `activeStepLabel: string` | Human-readable step label |
| `isRunning`, `isLoading`, `error` | UI state flags |
| `playbackVersion: useRef(0)` | Incremented on every new run / direct toggle — cancels stale playback loops |
| `chatLog: ChatLogMessage[]` | Rolling conversation memory (max 80); synced to `localStorage["greenify.chat_log.v1"]`. Last 16 turns sent to the backend on the next `planAndExecute` as `chat_history`. |
| `savingsHistory: SavingsRunRecord[]` | Every completed run appended via `appendSavingsRecord`; synced to `localStorage["greenify.savings_history.v1"]` (cap 500). |
| `isMonthlySavingsOpen`, `monthlyView` | Controls the Monthly Savings modal visibility and cost/energy toggle |

### 5.2 Playback Loop

`playback(response)` walks `response.snapshots[]`. Each step calls `setDisplayedState(snapshot.state)` + `setActiveStep(snapshot.step)` and awaits a delay:

- Step 0: **600 ms** (initial settle)
- Every subsequent step: **1100 ms**

Before each step, it checks `playbackVersion.current` — if the user clicked "Run" again or toggled a device, the old loop aborts cleanly. If `snapshots[]` is empty, it short-circuits to `final_state`.

### 5.3 Layout (desktop)

```
┌──────────────────────────────────────────────────────────────────┐
│ Header (grid xl:grid-cols-[1.08fr_0.92fr])                       │
│ ┌────────────────────────────┐  ┌────────────────────────────┐   │
│ │ Greenify brand + Conversa- │  │ Run Status                  │  │
│ │ tion Memory                │  │ - workflow status           │  │
│ │ (last 10 chat turns,       │  │ - step label + progress bar │  │
│ │  Clear button)             │  │ - Before/After/Saved/Value  │  │
│ │                            │  │ - This run / Today / Monthly│  │
│ │                            │  │ - "View Monthly Savings" btn│  │
│ └────────────────────────────┘  └────────────────────────────┘   │
│                                                                  │
│ Main (xl:grid-cols-[1.35fr_0.95fr])                              │
│ ┌────────────────────────────────┐ ┌──────────────────────────┐  │
│ │ 1. Define The Goal             │ │ Decision Console         │  │
│ │   - textarea                   │ │ (Engine pill, interpreted│  │
│ │   - Run Optimizer button       │ │  goal, estimated impact, │  │
│ │                                │ │  key actions, protected/ │  │
│ │ 2. Watch The Home Simulation   │ │  skipped, reasoning,     │  │
│ │   - HouseScene (600px tall)    │ │  assumptions, constraints│  │
│ │   - protection / scope /       │ │                          │  │
│ │     timeline legend cards      │ │ Selected Actions         │  │
│ │                                │ │ (numbered, reached step  │  │
│ │                                │ │  highlighted, $ per act) │  │
│ │                                │ │                          │  │
│ │                                │ │ Skipped Actions          │  │
│ │                                │ │                          │  │
│ │                                │ │ Execution Timeline       │  │
│ └────────────────────────────────┘ └──────────────────────────┘  │
│                                                                  │
│ Monthly Savings Modal (overlay, opens on demand)                 │
│ - Cost/Energy toggle                                             │
│ - 30-day SavingsTrendChart                                       │
│ - Totals: month value, month kWh, CO₂ avoided, runs this month   │
│ - Category breakdown (EV, lighting, HVAC, laundry, screens, other)│
└──────────────────────────────────────────────────────────────────┘
```

Max width: `1700px`. Responsive breakpoints: `sm`, `lg`, `xl`.

### 5.4 3D Scene (`HouseScene.tsx`)

- **Canvas:** `<Canvas shadows camera={{ position: [9, 11, 13], fov: 44 }}>`
- **Background:** `#f0ede6` (warm off-white)
- **Lighting:** ambient `1.0`; directional from `[10, 14, 8]`, color `#fff8f2`, intensity `1.5`, 2048² shadow map; `<Environment preset="apartment" />` for reflections
- **OrbitControls:** pan disabled; pitch `0.6 → 1.35` rad; zoom `10 → 24`
- **House:** 2 floors × 6 rooms + exterior porch light + exterior HVAC unit
  - Floor 1: Living Room (accent `#b8956a`), Kitchen (`#adb38a`), Garage (`#a0a09a`)
  - Floor 2: Bedroom (`#c49a7a`), Office (`#9aab8a`), Laundry (`#9090a8`)
  - Interlevel slab and stair indication between floors
  - Ground slab: `#c8bfb0`
  - Exterior outdoor HVAC condenser at `[4.2, 0.3, 2.5]` (right of house)
- **Animations** (in `devices.tsx`):
  - `useLerpLight` — `pointLight.intensity += (target - current) * 0.08` per frame
  - `useLerpEmissive` — same for `material.emissiveIntensity` + emissive color
  - `Fan` — `group.rotation.y += (rpm/60 * 2π) * delta`
  - EV charger ring pulses orange when paused, green when charging

### 5.5 Device Components (in `devices.tsx`)

| Component | State fields read | Visual treatment |
|---|---|---|
| `Lamp` | `is_on`, `brightness`, `color` prop | Bulb emissive + point light lerp |
| `ScreenDevice` | `screen_on` | Blue emissive panel fade |
| `Fan` | `rotation_rpm` | Blade group rotates, tint shifts green when spinning |
| `Fridge` | — | Static mesh (no state binding) |
| `EVCharger` | `charger_status` | Torus ring: green emissive charging, terracotta paused |
| `PorchLight` | `is_on`, `brightness`, `scheduled` | Bulb emissive + pointLight; orange tint when scheduled |
| `Washer` / `Dryer` / `Dishwasher` | `is_on` | Porthole/door + LED indicator fades green |
| `HVACUnit` | `is_on` | Silver condenser box + torus ring (cyan `#38bdf8` emissive when on, slate `#64748b` off); 4-blade fan spins on z-axis (≈2 Hz) when on; cyan `#7dd3fc` point light halo lerps on/off. Positioned exterior at world `[4.2, 0.3, 2.5]` — the standalone outdoor unit beside the house. |

### 5.6 Conversation Memory

Lives in `App.tsx` — no separate module.

- **Storage key:** `greenify.chat_log.v1` (localStorage).
- **Cap:** 80 messages (`trimChatLog`); older entries drop from the head.
- **Shape:** `ChatLogMessage = { role: "user" | "assistant", content: string, timestamp?: string }`.
- **Context window:** last 16 messages sent to the backend as the `chat_history` field on `planAndExecute`. The backend uses it for two things: (a) the rules planner's `_compose_goal_with_history` prepends it to the goal for keyword intent parsing; (b) `plan_with_llm` embeds a serialized replay in the user prompt so the model has the conversation context.
- **UI surface:** Conversation Memory card in the header shows the last 10 turns with role, time, and content; a Clear button resets both in-memory state and localStorage.
- **Assistant turn content:** auto-generated summary — *"{interpreted_goal} Executed N action(s), saved X W. Skipped M action(s) for safety."*

### 5.7 Savings Module (`savings.ts`)

The single source of truth for everything the Run Status panel and Monthly Savings modal display.

| Export | Purpose |
|---|---|
| `wattsToKwh(watts, hours)` | `watts * hours / 1000` |
| `getElectricityRate(peak: bool)` | `0.24` if peak, else `0.16` USD/kWh |
| `estimateRunSavings(response, peak)` | Uses `watts_saved` and the goal's inferred duration (e.g., *"for 3 hours"*) to compute kWh + USD for a single run |
| `createSavingsRunRecord(response)` | Builds a `SavingsRunRecord` with id, timestamp, goal, planner, duration, rate, watts/energy/cost saved, CO₂ avoided, category split |
| `appendSavingsRecord(history, record)` | Append + trim to 500; feeds `saveSavingsHistory` |
| `loadSavingsHistory`, `saveSavingsHistory` | localStorage accessors for `greenify.savings_history.v1` |
| `buildMonthlySavingsSeries(history, date, runEstimate)` | 30-day daily aggregate; if no real data, seeds synthetic baseline with realistic variance so the chart isn't blank on first run |
| `summarizeSavingsSeries(points)` | Totals the series into `{ energyKwh, costUsd, co2Kg }` |
| `buildMonthlyBreakdown(history, date, totals)` | Splits monthly savings across six categories (EV charging, laundry, lighting, HVAC, screens, other) using action categorization + weighted fallback |
| `getTodayTotals`, `getMonthTotals` | Short-window roll-ups |

The modal (`MonthlySavingsModal.tsx`) consumes these functions through props; the chart (`SavingsTrendChart.tsx`) is a thin SVG renderer over the monthly series.

---

## 6. Design System

This section is the canonical source for any marketing material — web, deck, video, one-pager. All tokens are already encoded in `tailwind.config.cjs` and `index.css`. Changing any value there updates both the product and this spec.

### 6.1 Color Palette

| Token (Tailwind) | Hex | Role |
|---|---|---|
| `canvas` | `#f5f0e8` | Page background base (warm paper) |
| `panel` | `#eee9de` | Card / panel surface |
| `panelStrong` | `#e4ddd0` | Emphasized panel surface |
| `accent` | `#4a7c59` | **Primary brand — forest green** |
| `accentWarm` | `#c17a3a` | Warnings, scheduled states, skipped actions — terracotta |
| `success` | `#2d7a4a` | Savings / positive deltas |
| `danger` | `#b94040` | Errors, emergency-fallback pill |
| `muted` | `#7a6e62` | Supporting text / labels |
| Body ink | `#263229` | Default text (set on `:root color`) |

#### Dollhouse accent palette (3D scene rooms)

Use these only for the 3D dollhouse. They're intentionally desaturated so the resident's attention stays on the animated devices.

| Hex | Room |
|---|---|
| `#b8956a` | Living Room |
| `#adb38a` | Kitchen |
| `#c49a7a` | Bedroom |
| `#9aab8a` | Office |
| `#9090a8` | Laundry |
| `#a0a09a` | Garage |
| `#c8bfb0` | Ground slab |

### 6.2 Backgrounds & Gradients

Page body (`:root` in `index.css`):

```css
background:
  radial-gradient(circle at 9% 8%, rgba(74,124,89,0.16), transparent 33%),
  radial-gradient(circle at 92% 10%, rgba(193,122,58,0.10), transparent 29%),
  linear-gradient(180deg, #f8f4ea 0%, #efe8db 100%);
```

`.app-shell` layers a softer second radial pass (forest + sage) for depth on scroll.

**Primary CTA gradient** (Run Agent button): `bg-gradient-to-r from-accent to-green-500`.

**Progress bar fill:** same gradient.

### 6.3 Typography

**Font stack:**

```
"Space Grotesk", "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif
```

> ⚠️ **Known gap for marketing parity:** Space Grotesk is referenced in Tailwind + CSS but is **not loaded** by `index.html` (no Google Fonts link). The browser currently renders IBM Plex Sans or the system UI font. For true brand parity in screenshots/video, add this to `<head>` in `frontend/index.html`:
>
> ```html
> <link rel="preconnect" href="https://fonts.googleapis.com">
> <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
> <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
> ```

**Type scale in use:**

| Role | Tailwind classes | Color |
|---|---|---|
| Hero H1 | `text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight` | `stone-900` |
| Section title | `text-lg font-semibold` | `stone-900` |
| Eyebrow | `text-xs font-semibold uppercase tracking-[0.22em–0.26em]` | `accent` |
| Panel label | `text-xs font-semibold uppercase tracking-[0.18em–0.22em]` | `stone-500` |
| Body | `text-sm leading-6` | `stone-600` |
| KPI numeric | `text-base`–`text-2xl font-semibold` | `stone-900` |
| Data pill | `text-xs font-medium` | `stone-600` |

**Text rendering:** body uses `font-synthesis: none`, `text-rendering: optimizeLegibility`, `-webkit-font-smoothing: antialiased`. Keep these for all brand surfaces.

### 6.4 Component Primitives

Shared classes in `frontend/src/index.css`:

```css
.panel         → rounded-3xl border border-stone-900/10 bg-panel shadow-glow backdrop-blur-xl
.panel-title   → text-xs font-semibold uppercase tracking-[0.22em] text-stone-500
.data-pill     → rounded-full border border-stone-900/10 bg-stone-900/5 px-3 py-1 text-xs font-medium text-stone-600
.kpi-card      → rounded-2xl border border-stone-900/10 bg-stone-100/85 px-4 py-3 shadow-sm backdrop-blur
.input-surface → rounded-2xl border border-stone-900/10 bg-stone-50/90 p-4 text-sm
                 focus:border-accent/40 focus:ring-2 focus:ring-accent/15 placeholder:text-stone-400
```

**Elevation:** single token `shadow-glow = 0 8px 32px rgba(80, 60, 40, 0.10)` (warm cast, not black).

**Borders:** always hairline `border-stone-900/10` — never full-opacity black.

**Corner radius scale:**
- `rounded-full` — pills, round controls
- `rounded-2xl` — inputs, cards, buttons, KPI cards
- `rounded-3xl` — top-level panels

### 6.5 Motion Language

| Surface | Behavior |
|---|---|
| Header / hero | `framer-motion` — `initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}` |
| Step label overlay (3D) | `initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}` |
| Progress bar | `transition-all duration-500` on width |
| 3D lights & emissives | Per-frame lerp, factor `0.08` toward target |
| Fan blades | Continuous rotation proportional to `rotation_rpm` |
| Playback cadence | Step 0 = 600 ms, step N = 1100 ms |

Rule of thumb: motion should feel **physical, not flashy**. No bounce, no exaggerated easing. Everything glides.

### 6.6 Status & Pill Treatments

| Surface | Classes |
|---|---|
| Planner pill (LLM active) | `border-accent/30 bg-accent/15 text-accent` |
| Planner pill (rules fallback) | Default `.data-pill` (stone-neutral) |
| Error banner | `rounded-xl border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger` |
| Savings card (Saved) | `border-success/30 bg-success/10` |
| Skipped-action card | `border-accentWarm/25 bg-accentWarm/10` |
| Run-Agent button (primary) | `rounded-2xl bg-gradient-to-r from-accent to-green-500 text-white ring-1 ring-accent/30 hover:brightness-105 disabled:opacity-60` |
| Starter-goal chip | `rounded-full border border-stone-900/10 bg-stone-50 hover:border-accent/35 hover:bg-accent/8` |

### 6.7 Brand Voice (hooks for marketing copy)

Verbatim language already in the product — use these as canonical taglines:

- **Headline:** *"Translate plain-English goals into safe, visible home energy actions."*
- **Subhead:** *"The left side is your command workspace and simulation. The right side is the decision console that explains what the agent planned, what it skipped, and why."*
- **Demo prompts** (the starter-chip buttons were removed in favor of a free-form textarea, but these are the canonical marketing demos that still exercise every scenario path):
  - "I'm leaving for 3 hours. Reduce energy use but keep the house secure." (away)
  - "Lower my bill during peak hours without making the house uncomfortable." (peak pricing + HVAC)
  - "Prepare the house for sleep mode." (sleep)
  - "It's 95°F outside — keep the house comfortable even if it costs more." (HVAC-forced-on)
- **Status labels:** *Ready* → *Loading home state* → *Executing plan* → *Run complete*
- **Planner labels:** *OpenAI Planner* (primary) / *Rules Fallback* (emergency)

Voice cues: confident, transparent, never magical. The agent *selects*, *preserves*, *defers*, *skips* — it does not "optimize your life."

---

## 7. Environment & Running

### Backend

```bash
cd backend
cp .env.example .env      # then fill in OPENAI_API_KEY
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Server listens on `$HOST:$PORT` (default `0.0.0.0:8000`).

### Frontend

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

Override API base with `VITE_API_URL` (default `http://localhost:8000`).

### One-shot (root)

See `Makefile` targets if present — the typical flow is `make backend` and `make frontend` in separate terminals.

### Known Gaps

1. **Space Grotesk is not loaded** (see §6.3) — add Google Fonts link for brand parity.
2. **`kitchen_fridge` has no 3D mesh** — backend-only device; contributes to wattage but invisible in scene.
3. **State is in-memory** — `HomeStateStore` resets on server restart. Only real-device state (e.g., the plug) survives via the adapter.
4. **`services/openai_agent.py` is dormant** — `OpenAIPlanner` (Responses API + strict schema) is instantiated by `EnergyAgent.__init__` but never called on the `plan_and_execute` path. Safe to delete once nothing imports it, or reintroduce as an alternate planner strategy.
5. **CORS is wide open** — `main.py` uses `allow_origins=["*"]`. Fine for the demo; production needs an explicit origin list.
6. **HVAC has no room** — `central_hvac.room = "system"` is a sentinel, not a physical room. Scope-matching that filters by room label won't match it; HVAC decisions are driven by outdoor temperature + comfort band instead.
7. **HVAC has only binary on/off** — the planner cannot currently request a setpoint change (e.g. *"raise the thermostat to 78°F"*). Any such nuance is collapsed into ON or OFF.
8. **Rules fallback covers a subset of the vocabulary** — only `turn_off`, `fan_slow`/`fan_off`, and `pause_charging`. Richer verbs (`set_brightness`, `resume_charging`) are LLM-only, so a rules-path run on a peak-pricing prompt won't dim lights — it'll turn them off entirely.
9. **LLM-estimated `estimated_savings_watts` can be wrong** — the per-action figure in the Selected Plan card comes from the LLM. The authoritative savings (Run Status panel, monthly rollups) are recomputed from the state delta by `compute_device_draw` and are unaffected.

---

## 8. Glossary

- **`HomeState`** — full snapshot: occupancy, time, peak pricing, outdoor temp, comfort band, devices[], total watts.
- **`DeviceState`** — per-device mutable fields: `is_on`, `brightness`, `screen_on`, `rotation_rpm`, `charger_status`, `scheduled`, `schedule_note`.
- **`GoalIntent`** — rules-derived interpretation of the user's goal: mode, activity, protected rooms, action scope, preservation flags.
- **`PlanAction`** — a proposed (or executed) action with full target state, title, description, reason, estimated savings, priority.
- **`SkippedAction`** — action rejected by validation or scope, with human-readable reason.
- **`ExecutionResult`** — one row of the run log: action_id, status, message, resulting wattage.
- **`HomeStateSnapshot`** — state at step N with a label; drives the 3D playback loop.
- **`AgentResponse`** — the full payload sent to the frontend: parsed intent, plan, skipped, execution results, snapshots, before/after watts, planner label.
- **Target state** — the exact `DeviceState` an action will write into the device if executed. On the LLM path, the model writes this directly; on the rules path, `_candidate_actions` generates it.
- **Planner** — which path produced the plan: `llm` (OpenAI `chat.completions` with JSON-object mode, validated via `LLMPlan` Pydantic) or `rules` (deterministic fallback in `agent.py`).
- **Emergency fallback** — the rules-based path that runs when the LLM is unavailable or returned bad data; honest by design — the UI explicitly labels it and `planner_notice` carries the reason string.
- **Chat history** — the trailing slice of `ChatLogMessage`s (cap 16 turns) sent with each `planAndExecute` request. Lets follow-up goals like *"now turn the lights back on"* reference prior state.
- **Savings history** — persistent log of completed runs (localStorage `greenify.savings_history.v1`) that feeds the Monthly Savings modal's trend chart and category breakdown.
- **HVAC climate-support window** — the ±2°F band around the comfort range that determines whether the planner considers HVAC worth running. Beyond ±8°F the planner treats the weather as "extreme" and overrides cost-saving prompts to keep HVAC on.
- **Prompt-Driven State** — the label displayed in the 3D scene's mode pill. Replaces the older scenario-name labels ("Away", "Peak Pricing", "Sleep Prep"), reflecting that the planner now reacts to the typed goal rather than a pre-selected scenario.
