# Greenify

Greenify is a demo-ready hackathon web app that turns natural-language energy goals into autonomous home actions. A FastAPI backend reasons over the current home state, produces an ordered action plan with visible constraint handling, and a React + Three Fiber frontend plays the plan back in a stylized 3D dollhouse where devices visibly power down step by step.

## Project Overview

- Natural-language goals, not device-by-device control
- OpenAI-backed agent planning with deterministic safety rails
- 3D cutaway home with sequential visual execution
- Mock smart plug integration by default, with a clean real-adapter seam
- Seeded demo scenarios for away mode, peak pricing, and sleep mode

## Architecture

### Frontend

- `frontend/`
- React + TypeScript + Vite
- Tailwind CSS for layout and dark UI polish
- React Three Fiber + Drei for the 3D house
- Framer Motion for panel and timeline transitions

The frontend treats the backend response as the source of truth for execution. It replays the returned state snapshots in order so the execution log, 3D scene, and power metrics stay synchronized during the demo.

### Backend

- `backend/`
- FastAPI with Pydantic models
- In-memory seeded home state store
- OpenAI Responses API integration with deterministic execution constraints
- Smart plug service abstraction with `MockSmartPlugService` enabled by default

The backend owns the simulated home state, generates safe candidate actions, asks OpenAI to interpret and order the plan when configured, executes only validated actions, and returns both the final state and intermediate snapshots for playback.

## Agent Flow

Greenify uses a hybrid OpenAI + rules pipeline:

1. Parse the user goal into structured intent.
2. Inspect the current home state and active scenario signals.
3. Generate candidate actions for controllable devices.
4. Apply hard constraints.
5. Send the constrained planning context to the OpenAI Responses API.
6. Produce a final ordered plan.
7. Execute actions sequentially.
8. Return reasoning, skipped actions, execution results, and updated home-state snapshots.

When `OPENAI_API_KEY` is not configured or the API call fails, Greenify falls back to the local planner so the demo path still works.

Hard constraints demonstrated in the app:

- Refrigerator remains on because it is essential.
- Porch light is preserved in away mode because it is security-related.
- EV charging is deferred instead of canceled.
- Only remote-controllable devices are eligible for execution.

## Repo Structure

```text
.
├── backend
│   ├── app
│   │   ├── api
│   │   ├── core
│   │   ├── models
│   │   └── services
│   ├── requirements.txt
│   └── tests
├── frontend
│   ├── src
│   │   ├── components
│   │   └── data
│   └── package.json
├── Makefile
└── README.md
```

## Setup

### Prerequisites

- Node.js 20+
- Python 3.11+ or newer

### Environment Files

Copy the example env files if you want to override defaults:

- `frontend/.env.example`
- `backend/.env.example`

The default frontend API target is `http://localhost:8000`.

### OpenAI configuration

Set these in `backend/.env` or your shell:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` default: `gpt-5-mini`
- `OPENAI_REASONING_EFFORT` default: `low`

The backend uses the OpenAI Responses API for plan interpretation and ranking, then executes only actions that survive local hard-constraint checks.

## Run The Project

### Install dependencies

```bash
cd frontend
npm install

cd ../backend
python3 -m pip install -r requirements.txt
```

### Start the backend

```bash
cd backend
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Start the frontend

```bash
cd frontend
npm run dev -- --host 0.0.0.0 --port 5173
```

### Optional Makefile shortcuts

```bash
make backend
make frontend
```

## API Endpoints

- `GET /api/health`
- `GET /api/home-state`
- `POST /api/scenario/reset`
- `POST /api/agent/plan-and-execute`

### Example scenario reset

```bash
curl -X POST http://localhost:8000/api/scenario/reset \
  -H "Content-Type: application/json" \
  -d '{"scenario_id":"peak_pricing"}'
```

### Example plan execution

```bash
curl -X POST http://localhost:8000/api/agent/plan-and-execute \
  -H "Content-Type: application/json" \
  -d '{"goal":"I am leaving for 3 hours. Reduce energy use but keep the house secure."}'
```

## Demo Scenarios

The UI includes three seeded demo presets:

1. Away mode
   `I’m leaving for 3 hours. Reduce energy use but keep the house secure.`
2. Peak pricing mode
   `Lower my bill during peak hours without making the house uncomfortable.`
3. Sleep mode
   `Prepare the house for sleep mode.`

## Smart Plug Integration

The simulated `office_demo_plug_lamp` is mapped to the smart plug service layer.

## OpenAI Integration

Greenify uses the official OpenAI Python SDK and the Responses API for the AI planner.

- Planner service: [backend/app/services/openai_agent.py](/Users/kanishkkovuru/Downloads/Coding/ClaudeHack/greenify/backend/app/services/openai_agent.py)
- Agent orchestration: [backend/app/core/agent.py](/Users/kanishkkovuru/Downloads/Coding/ClaudeHack/greenify/backend/app/core/agent.py)
- Runtime settings: [backend/app/core/settings.py](/Users/kanishkkovuru/Downloads/Coding/ClaudeHack/greenify/backend/app/core/settings.py)

The OpenAI model is responsible for:

- Interpreting the natural-language goal
- Refining assumptions and constraint phrasing
- Selecting and ordering actions from the safe candidate set
- Writing human-readable action rationales for the demo

The local backend remains responsible for:

- Hard constraints
- Candidate action generation
- Real and mock smart plug calls
- State mutation and execution playback

This split keeps the app agentic without letting the model bypass safety or device constraints.

Backend services:

- `SmartPlugService`
- `MockSmartPlugService`
- `OptionalRealSmartPlugService`

By default, the mock implementation is used and returns a visible execution message in the agent log. To wire a real adapter later:

1. Set `REAL_SMART_PLUG_ENABLED=true` in `backend/.env`.
2. Provide `REAL_SMART_PLUG_API_KEY`.
3. Replace the stub logic in `backend/app/services/smart_plug.py` with your vendor SDK call.
4. Keep the same `set_power(device_id, turn_on)` contract so the rest of the app stays unchanged.

## Verification

Checks used during implementation:

- `python3 -m compileall backend/app backend/tests`
- `cd frontend && npm run build`

The frontend production build completes successfully. The backend app also starts successfully under `uvicorn`, and the live API was exercised against:

- `GET /api/health`
- `GET /api/home-state`
- `POST /api/agent/plan-and-execute`

## Troubleshooting

- If the frontend cannot reach the backend, confirm `VITE_API_URL` points to `http://localhost:8000`.
- If `uvicorn` is not found, use `python3 -m uvicorn ...` instead of relying on your shell PATH.
- If Python packages install outside your default PATH, that is fine as long as `python3 -m uvicorn` works.
- If the 3D scene feels blank, confirm the backend loaded and the browser console has no failed API requests.

## Known Limitations

- Home state is in-memory only; restarting the backend resets the demo state.
- The agent is deterministic rather than backed by a live LLM by default.
- The real smart plug adapter is a clean stub, not a vendor-specific production integration.
- The 3D house uses primitives instead of detailed imported assets to keep the demo reliable and lightweight.

## Suggested Live Demo Script For Judges

1. Open the app with the Away mode scenario selected.
2. Point out the initial whole-home load and the visible devices that are currently on.
3. Read the goal out loud: “I’m leaving for 3 hours. Reduce energy use but keep the house secure.”
4. Run the agent and narrate the reasoning panel as it identifies constraints.
5. Highlight that the EV charger pauses first because it is the largest flexible load.
6. Call out the smart-plug-backed office lamp turning off and the matching log message.
7. Point to the refrigerator skip and porch-light preserve decision to show the agent is reasoning, not blindly shutting everything down.
8. End on the before/after energy delta and final watt savings.
