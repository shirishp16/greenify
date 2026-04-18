# Greenify smart plug demo — Home Assistant + Matter

This directory runs a Home Assistant instance with the Matter integration on the demo laptop. The Greenify backend calls HA's REST API, and HA drives the GE Cync Indoor Smart Plug (Matter over Wi-Fi). The plug is commissioned from an iPhone first, then shared into HA via Matter multi-admin.

## One-time setup

1. **Install Docker Desktop.**

2. **Start the stack:**
   ```bash
   cd demo/home-assistant
   docker compose up -d
   ```
   First start takes ~2 minutes. Verify HA at <http://localhost:8123> and finish the onboarding wizard (create a user, skip location/analytics).

3. **Commission the plug to your iPhone first.**
   - Open Apple Home (or Google Home) on the iPhone.
   - "Add Accessory" → scan the Matter QR code on the GE Cync box.
   - Join it to the venue's 2.4 GHz Wi-Fi.
   - Toggle it on/off from the phone to confirm the lamp responds.

4. **Enable the Matter integration in HA.**
   - Settings → Devices & Services → Add Integration → Matter.
   - It should auto-detect the local `python-matter-server` container (`ws://localhost:5580/ws`).

5. **Share the plug from the phone to HA.**
   - In Apple Home: long-press the plug → Settings → Turn On Pairing Mode → copy the fresh 11-digit Matter code.
   - In HA: the Matter integration card → "Add device" → paste the code.
   - HA should list the plug as a `switch.*` entity. Rename to `switch.office_demo_plug_lamp` (Settings → Devices → the plug → gear icon → Entity ID).
   - Toggle from the HA UI to confirm the lamp responds.

6. **Generate a long-lived access token.**
   - HA profile (bottom-left avatar) → Security tab → "Create Token" at the bottom.
   - Copy the token.

7. **Wire it into the backend.**
   In `backend/.env`:
   ```
   REAL_SMART_PLUG_ENABLED=true
   HA_BASE_URL=http://localhost:8123
   HA_TOKEN=<paste token>
   HA_ENTITY_ID_OFFICE_DEMO_PLUG_LAMP=switch.office_demo_plug_lamp
   ```
   Restart the backend.

## Day-of-demo checklist

- `docker compose up -d` at least 10 minutes before showtime (HA cold start is slow).
- Plug a ~50 W lamp into the Cync (matches the seeded `office_demo_plug_lamp` wattage).
- From the HA UI, toggle the switch — confirm the lamp blinks. If not, fix HA before touching Greenify.
- Run the end-to-end smoke test from `backend/`:
  ```bash
  curl -X POST localhost:8000/api/scenario/reset \
       -H 'Content-Type: application/json' \
       -d '{"scenario_id":"away_mode"}'
  curl -X POST localhost:8000/api/agent/plan-and-execute \
       -H 'Content-Type: application/json' \
       -d '{"goal":"save energy while away"}'
  ```
  The lamp should physically turn off the moment `office_demo_plug_lamp` flips in the returned snapshots.

## Stop / reset

```bash
docker compose down          # stop
docker compose down -v       # stop + remove volumes (loses HA onboarding + pairings)
rm -rf config matter-data    # full wipe
```

## Troubleshooting

- **HA can't find matter-server:** both containers use `network_mode: host`, so they must run on Linux/macOS with Docker Desktop. On Windows/WSL host networking is limited — use a bridge network and point HA at `ws://host.docker.internal:5580/ws`.
- **Plug won't accept the pairing code in HA:** Matter codes are single-use. Generate a fresh one from Apple Home each attempt.
- **Plug offline after switching networks:** the Cync remembers one Wi-Fi. If the venue drops and you need the iPhone hotspot, factory-reset the plug (hold the button ~10 s) and re-commission via Apple Home.
- **Greenify agent says "No Home Assistant entity mapped":** the `HA_ENTITY_ID_<DEVICE_ID>` env var must match the seeded device id, uppercased. The `office_demo_plug_lamp` seed maps to `HA_ENTITY_ID_OFFICE_DEMO_PLUG_LAMP`.
