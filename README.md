# Greenify

**AI-powered home energy optimization with a live 3D simulation.** Type a plain-English goal — *"I'm leaving for 3 hours, keep the house secure"* — and an OpenAI-backed planner decides which devices to change, a strict validator gates every action, and a React + Three.js dollhouse replays the state changes step by step. Savings are computed from the actual state delta, not the model's estimate.

## Awards

1st Place: Claude Hacks @ OSU 2026 - Sustainability Track (Sponsored by Anthropic and IGS Energy)

---

## What It Does

- **Natural-language control.** One prompt drives a plan across 13 smart devices in 5 rooms. No per-device UI.
- **LLM planning with hard safety rails.** OpenAI proposes the plan; a Python validator enforces device-level constraints (essential devices, remote-control flags, per-action-type invariants) before execution.
- **3D replay, not 3D decoration.** Each backend execution snapshot is animated in a Three.js scene — lamps dim, TVs dark, fans spin down, EV chargers pause — so every action is visually auditable.
- **Conversation memory.** Follow-up goals ("now turn the lights back on") carry the last 16 messages as context, persisted in the browser.
- **Savings that stack.** Every run feeds a 30-day trend, monthly projection, CO₂ estimate, and per-category breakdown (EV / lighting / HVAC / laundry / screens / other).
- **Honest fallback.** If the LLM call fails or returns an invalid plan, the backend falls back to a deterministic rules engine and labels the response accordingly — no fake LLM output.

---

## How It Works

```
 ┌───────────┐    prompt + chat_history    ┌───────────────────────┐
 │  Browser  │ ──────────────────────────▶ │  FastAPI              │
 │ (React +  │                              │  /api/agent/          │
 │  Three.js)│                              │  plan-and-execute     │
 └─────▲─────┘                              └──────────┬────────────┘
       │                                               │
       │ AgentResponse                                 │ plan_with_llm()
       │ (snapshots, plan, metrics,                    ▼
       │  reasoning, skipped, planner flag)      ┌──────────┐
       │                                         │  OpenAI  │
       │                                         └────┬─────┘
       │                                              │ LLMPlan JSON
       │                                              ▼
       │                              ┌──────────────────────────────┐
       │                              │  _validate_action_against_   │
       │                              │  device()  — drops illegal   │
       │                              │  actions, records reasons    │
       │                              └──────────────┬───────────────┘
       │                                             │
       │                              ┌──────────────▼───────────────┐
       └──────────────────────────────┤  Execution loop:             │
                                      │  apply target_state per step,│
                                      │  snapshot, recompute watts   │
                                      └──────────────────────────────┘
```

The frontend replays snapshots with configurable step delays so the 3D scene, the execution timeline, and the watt metrics stay perfectly in sync.

---

## Tech Stack

| Layer | Stack |
|---|---|
| Backend | Python 3.11+, FastAPI, Pydantic v2, OpenAI SDK (`chat.completions` + JSON mode), python-dotenv |
| Frontend | React 18, TypeScript, Vite, Tailwind, React Three Fiber + Drei, Framer Motion |
| State | In-memory `HomeStateStore` (resets on server restart); localStorage for chat + savings |
| Integrations | Smart plug adapter (mock by default; Apple Shortcuts and Home Assistant adapters available) |

---

## Quick Start

```bash
# 1. Install
cd backend && python3 -m pip install -r requirements.txt
cd ../frontend && npm install

# 2. Configure the LLM (required for the OpenAI planning path)
echo "OPENAI_API_KEY=sk-..." >> backend/.env
echo "OPENAI_MODEL=gpt-4o-mini" >> backend/.env

# 3. Run — two terminals
make backend    # → http://localhost:8000
make frontend   # → http://localhost:5173
```

Without `OPENAI_API_KEY`, the app still runs — the rules-engine fallback kicks in and the UI labels it "Safety Rules Engine".

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | Enables the LLM planner path |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model used by `plan_with_llm` |
| `REAL_SMART_PLUG_ENABLED` | `false` | Toggle the real smart-plug adapter |
| `REAL_SMART_PLUG_API_KEY` | — | Vendor credential for the real adapter |
| `APPLE_SHORTCUT_<DEVICE>_ON`/`_OFF` | — | macOS Shortcuts bridge (highest priority) |
| `HA_BASE_URL`, `HA_TOKEN`, `HA_ENTITY_ID_<DEVICE>` | — | Home Assistant bridge |
| `VITE_API_URL` | `http://localhost:8000` | Frontend → backend target |

---

## API

The demo flow uses four `/api/*` routes. A separate `/igs/*` router in [backend/app/api/igs.py](backend/app/api/igs.py) exposes grid-services endpoints (`home-profile`, `optimization-result`, `event-response`).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/home-state` | Current `HomeState` (all devices + environment) |
| `POST` | `/api/agent/plan-and-execute` | Main endpoint. Accepts `{ goal, chat_history }`, returns full `AgentResponse` |
| `POST` | `/api/device/{device_id}/toggle` | Flip a single device on/off (used by the clickable smart-plug lamp) |

```bash
curl -X POST http://localhost:8000/api/agent/plan-and-execute \
  -H "Content-Type: application/json" \
  -d '{"goal":"I am leaving for 3 hours. Reduce energy use but keep the house secure.","chat_history":[]}'
```

The response includes `planner` (`"llm"` | `"rules"`), `interpreted_goal`, `reasoning_summary`, `assumptions`, `constraints_applied`, `selected_plan`, `skipped_actions`, `execution_results`, `snapshots`, and watt metrics.

---

## Action Vocabulary

Seven closed action types, defined in [backend/app/models/schemas.py](backend/app/models/schemas.py) as `SUPPORTED_ACTION_TYPES` and mirrored in the LLM system prompt.

| Action type | Applies to | `target_state` requirement |
|---|---|---|
| `turn_off` | light, screen, fan, smart_plug, ev_charger | `is_on=false`; type-specific fields zeroed |
| `turn_on` | light, screen, fan, smart_plug | `is_on=true`; `brightness>0` or `rpm>0` |
| `screen_off` | screen | `is_on=false`, `screen_on=false` |
| `set_brightness` | light, smart_plug | `is_on=true`, `brightness ∈ (0,1]` |
| `set_fan_speed` | fan | `rpm≥0`; `is_on` matches |
| `pause_charging` | ev_charger | `charger_status="paused"`, `scheduled=true` |
| `resume_charging` | ev_charger | `charger_status="charging"`, `scheduled=false` |

---

## Device Catalog

Thirteen devices defined in [backend/app/core/state.py](backend/app/core/state.py). Twelve are rendered in the 3D scene; `kitchen_fridge` is state-only.

| ID | Type | Room | Flags |
|---|---|---|---|
| `living_room_lamp` | light | living room | comfort |
| `living_room_tv` | screen | living room | — |
| `kitchen_ceiling_light` | light | kitchen | — |
| `kitchen_fridge` | fridge | kitchen | **essential** |
| `kitchen_dishwasher` | appliance | kitchen | deferrable |
| `bedroom_lamp` | light | bedroom | comfort |
| `bedroom_fan` | fan | bedroom | comfort |
| `office_monitor` | screen | office | — |
| `office_demo_plug_lamp` | smart_plug | office | **real_device** |
| `garage_ev_charger` | ev_charger | garage | deferrable |
| `porch_light` | light | exterior | **security** |
| `laundry_washer` / `laundry_dryer` | appliance | laundry | deferrable |

The backend infers one of three scenario profiles (`away_mode`, `peak_pricing`, `sleep_mode`) from keywords in the goal via `build_home_state_from_goal()` — there is no manual scenario switcher.

---

## Frontend Feature Map

| Section | What it shows | Persists to |
|---|---|---|
| **Conversation Memory** | Last 10 turns in the header; last 16 sent to the backend as `chat_history` | localStorage `greenify.chat_log.v1` (cap 80) |
| **Run Status** | Before/after watts, watts saved, $ value, today, monthly projection, progress bar | in-memory |
| **1. Define The Goal** | Free-form textarea → `planAndExecute()` | — |
| **2. Watch The Home Simulation** | Three.js house; replays `snapshots` with 600 ms / 1100 ms step delays; clickable `office_demo_plug_lamp` hits `/api/device/.../toggle` | — |
| **Decision Console** | Planner engine badge, interpreted goal, impact, top 3 actions, protected rooms, skipped count, reasoning, assumptions, constraints | — |
| **Selected Actions** | Ordered plan with per-action watts and $ value | — |
| **Skipped Actions** | Safety holds with human-readable reasons | — |
| **Execution Timeline** | Per-step log tied to the currently-displayed snapshot | — |
| **Monthly Savings Modal** | 30-day trend chart, cost/energy toggle, category breakdown, CO₂ avoided, runs this month | localStorage `greenify.savings_history.v1` (cap 500) |

`parsed_intent` on the agent response (mode, duration, protected rooms, action scope) drives room highlighting and scope filtering in the 3D scene.

---

## Safety Validation

`_validate_action_against_device()` in [backend/app/core/agent.py](backend/app/core/agent.py) drops any LLM-proposed action that:

- Targets an unknown `device_id`.
- Targets a non-`remote_controllable` device.
- Would set `is_on=false` on an `essential` device (e.g., `kitchen_fridge`).
- Violates the per-action-type `target_state` contract (e.g., `set_brightness` with `brightness=0`, or `pause_charging` without `charger_status="paused"`).

Rejected actions surface in `skipped_actions` with a reason string; the LLM is not re-called. Valid actions re-sort by `priority` and execute sequentially.

---

## Planner Engines

**LLM path (default).** [backend/app/core/llm_planner.py](backend/app/core/llm_planner.py) serializes the full home state, calls `client.chat.completions.create(...)` with `response_format={"type":"json_object"}` and `temperature=0.2`, then parses the response into an `LLMPlan` Pydantic model. The system prompt gives the model the closed action vocabulary, per-type `target_state` contracts, and worked examples so it self-polices before the validator has to reject.

**Rules fallback.** If the LLM call fails, the response is malformed, or any action uses an unsupported type, `plan_with_llm` returns `None` and the agent falls through to `_candidate_actions` + `_prioritize` — a deterministic if-tree covering `turn_off`, `fan_slow` / `fan_off`, and `pause_charging`. The response is marked `planner="rules"` with a `planner_notice` explaining why.

---

## Repo Layout

```
greenify/
├── backend/
│   ├── app/
│   │   ├── api/          # routes.py, igs.py
│   │   ├── core/         # agent.py, llm_planner.py, state.py, settings.py
│   │   ├── models/       # schemas.py
│   │   └── services/     # smart_plug.py, openai_agent.py
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── components/   # HouseScene, MonthlySavingsModal, SavingsTrendChart, SectionCard, house/*
│       ├── App.tsx  api.ts  savings.ts  types.ts
├── CLAUDE.md             # Deep reference for contributors
├── PRESENTATION.md       # Live demo script
└── Makefile
```

---

## Demo

A 2–3 minute live-demo script is in [PRESENTATION.md](PRESENTATION.md). Start the backend on `:8000` and the frontend on `:5173`, then follow the script.

---

## Known Limitations

- Home state is in-memory; restarting the backend resets everything except the real-device state held in the plug adapter.
- The rules fallback only covers a subset of the action vocabulary — richer actions (`set_brightness`, `resume_charging`) are LLM-only.
- `comfort_related` and `security_related` are guidance-only in the system prompt; the validator does not hard-enforce them.
- `kitchen_fridge` is in the catalog but not rendered in the 3D scene.
- The Three.js bundle exceeds Vite's 500 kB warning threshold — cosmetic, not a correctness issue.
