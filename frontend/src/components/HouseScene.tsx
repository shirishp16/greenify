import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import type { HomeState } from "../types";
import { RoomShell } from "./house/RoomShell";
import { Dishwasher, Dryer, EVCharger, Fan, Fridge, Lamp, PorchLight, ScreenDevice, Washer } from "./house/devices";

interface HouseSceneProps {
  homeState: HomeState | null;
  activeStepLabel: string;
  protectedRooms?: string[];
  actionScope?: string[];
  onDeviceToggle?: (deviceId: string) => void;
}

function findDevice(homeState: HomeState, deviceId: string) {
  return homeState.devices.find((device) => device.id === deviceId);
}

function HouseModel({
  homeState,
  protectedRooms = [],
  onDeviceToggle,
}: {
  homeState: HomeState;
  protectedRooms?: string[];
  onDeviceToggle?: (deviceId: string) => void;
}) {
  const livingLamp = findDevice(homeState, "living_room_lamp");
  const livingTv = findDevice(homeState, "living_room_tv");
  const kitchenLight = findDevice(homeState, "kitchen_ceiling_light");
  const bedroomLamp = findDevice(homeState, "bedroom_lamp");
  const bedroomFan = findDevice(homeState, "bedroom_fan");
  const officeMonitor = findDevice(homeState, "office_monitor");
  const smartPlugLamp = findDevice(homeState, "office_demo_plug_lamp");
  const charger = findDevice(homeState, "garage_ev_charger");
  const porchLight = findDevice(homeState, "porch_light");
  const dishwasher = findDevice(homeState, "kitchen_dishwasher");
  const washer = findDevice(homeState, "laundry_washer");
  const dryer = findDevice(homeState, "laundry_dryer");

  return (
    <group position={[0, -0.4, 0]}>
      {/* ── FIRST FLOOR ── */}
      <RoomShell
        position={[-3.1, 1.2, -1.6]}
        size={[3.4, 2.4, 2.8]}
        label="Living Room"
        accent="#b8956a"
        highlighted={protectedRooms.includes("living room")}
      >
        <Lamp position={[-0.8, -0.95, 0.1]} isOn={Boolean(livingLamp?.state.is_on)} brightness={livingLamp?.state.brightness} />
        <ScreenDevice position={[0.95, -1.08, -0.3]} isOn={Boolean(livingTv?.state.screen_on)} width={1.1} />
        {/* Sofa */}
        <mesh position={[-0.2, -1.0, 0.6]} castShadow>
          <boxGeometry args={[1.6, 0.35, 0.65]} />
          <meshStandardMaterial color="#a08060" roughness={0.8} />
        </mesh>
      </RoomShell>

      <RoomShell
        position={[0.2, 1.2, -1.6]}
        size={[3, 2.4, 2.8]}
        label="Kitchen"
        accent="#adb38a"
        highlighted={protectedRooms.includes("kitchen")}
      >
        <Lamp position={[-0.55, -0.95, 0.5]} isOn={Boolean(kitchenLight?.state.is_on)} brightness={kitchenLight?.state.brightness} />
        <Fridge position={[0.95, -1.15, -0.25]} />
        <Dishwasher position={[-0.88, -1.08, -0.38]} isOn={Boolean(dishwasher?.state.is_on)} />
        {/* Counter */}
        <mesh position={[-0.1, -1.08, -0.4]} castShadow>
          <boxGeometry args={[1.3, 0.18, 0.7]} />
          <meshStandardMaterial color="#8a7a6a" roughness={0.6} />
        </mesh>
      </RoomShell>

      {/* Interlevel floor slab (between first and second floor) */}
      <mesh position={[0.3, 2.57, -1.6]} receiveShadow>
        <boxGeometry args={[7.8, 0.12, 3.2]} />
        <meshStandardMaterial color="#c8b89a" roughness={0.7} />
      </mesh>

      {/* Stair indication (3 steps rising from ground floor to slab level) */}
      <mesh position={[-0.8, 0.35, 0.8]} castShadow>
        <boxGeometry args={[0.55, 0.7, 0.5]} />
        <meshStandardMaterial color="#b8a888" roughness={0.7} />
      </mesh>
      <mesh position={[-0.8, 0.85, 0.32]} castShadow>
        <boxGeometry args={[0.55, 0.35, 0.5]} />
        <meshStandardMaterial color="#b8a888" roughness={0.7} />
      </mesh>
      <mesh position={[-0.8, 1.25, -0.16]} castShadow>
        <boxGeometry args={[0.55, 0.35, 0.5]} />
        <meshStandardMaterial color="#b8a888" roughness={0.7} />
      </mesh>

      {/* ── SECOND FLOOR ── */}
      <RoomShell
        position={[-3.1, 3.85, -1.6]}
        size={[3.4, 2.4, 2.8]}
        label="Bedroom"
        accent="#c49a7a"
        highlighted={protectedRooms.includes("bedroom")}
      >
        <Lamp position={[-0.9, -0.95, 0.25]} isOn={Boolean(bedroomLamp?.state.is_on)} brightness={bedroomLamp?.state.brightness} color="#fca5a5" />
        <Fan position={[0.7, -1.05, -0.25]} rpm={bedroomFan?.state.rotation_rpm ?? 0} />
        {/* Bed */}
        <mesh position={[-0.15, -1.05, -0.2]} castShadow>
          <boxGeometry args={[1.5, 0.25, 0.85]} />
          <meshStandardMaterial color="#7a5c4a" roughness={0.7} />
        </mesh>
      </RoomShell>

      <RoomShell
        position={[0.2, 3.85, -1.6]}
        size={[3, 2.4, 2.8]}
        label="Office"
        accent="#9aab8a"
        highlighted={protectedRooms.includes("office")}
      >
        <ScreenDevice position={[0.75, -1.08, -0.18]} isOn={Boolean(officeMonitor?.state.screen_on)} width={0.82} />
        <Lamp
          position={[-0.75, -0.95, 0.3]}
          isOn={Boolean(smartPlugLamp?.state.is_on)}
          brightness={smartPlugLamp?.state.brightness}
          color="#5eead4"
          badge="Smart Plug"
          onClick={
            onDeviceToggle && smartPlugLamp ? () => onDeviceToggle(smartPlugLamp.id) : undefined
          }
        />
        {/* Desk */}
        <mesh position={[0.6, -1.08, -0.28]} castShadow>
          <boxGeometry args={[1.1, 0.12, 0.65]} />
          <meshStandardMaterial color="#8b7355" roughness={0.6} />
        </mesh>
      </RoomShell>

      {/* ── LAUNDRY (second floor, right of Office) ── */}
      <RoomShell position={[2.5, 3.85, -1.6]} size={[1.6, 2.4, 2.8]} label="Laundry" accent="#9090a8">
        <Washer position={[-0.27, -1.08, -0.28]} isOn={Boolean(washer?.state.is_on)} />
        <Dryer position={[0.27, -1.08, -0.28]} isOn={Boolean(dryer?.state.is_on)} />
      </RoomShell>

      {/* ── GARAGE (first floor, right wing) ── */}
      <RoomShell
        position={[3.1, 1.2, -0.1]}
        size={[2.2, 2.4, 5.7]}
        label="Garage"
        accent="#a0a09a"
        highlighted={protectedRooms.includes("garage")}
      >
        <EVCharger position={[0.2, -1.08, 0.5]} status={charger?.state.charger_status ?? "paused"} />
        {/* Garage floor mat */}
        <mesh position={[0, -1.08, -0.85]} castShadow>
          <boxGeometry args={[1.6, 0.18, 2.3]} />
          <meshStandardMaterial color="#9a9890" roughness={0.8} />
        </mesh>
      </RoomShell>

      {/* Porch Light */}
      <PorchLight
        position={[1.45, 1.5, 2.95]}
        isOn={Boolean(porchLight?.state.is_on)}
        brightness={porchLight?.state.brightness}
        scheduled={porchLight?.state.scheduled}
      />

      {/* Ground slab */}
      <mesh position={[0.3, -0.05, 0.2]} receiveShadow>
        <boxGeometry args={[10.5, 0.1, 7.5]} />
        <meshStandardMaterial color="#c8bfb0" roughness={0.8} />
      </mesh>
    </group>
  );
}

export function HouseScene({
  homeState,
  activeStepLabel,
  protectedRooms = [],
  actionScope = [],
  onDeviceToggle,
}: HouseSceneProps) {
  const [showActiveDevices, setShowActiveDevices] = useState(false);
  const activeDevices = useMemo(
    () =>
      (homeState?.devices ?? []).filter((device) => {
        if (device.type === "screen") {
          return Boolean(device.state.screen_on);
        }
        if (device.type === "fan") {
          return Boolean(device.state.rotation_rpm && device.state.rotation_rpm > 0);
        }
        if (device.type === "ev_charger") {
          return device.state.charger_status === "charging";
        }
        return device.state.is_on;
      }),
    [homeState],
  );

  return (
    <div className="panel relative h-[600px] overflow-hidden">
      <div className="absolute left-5 top-5 z-10 flex flex-wrap gap-2">
        <span className="data-pill bg-accent/15 text-accent">{homeState?.mode_label ?? "Loading"}</span>
        <span className="data-pill">{activeStepLabel}</span>
        {protectedRooms.map((room) => (
          <span key={room} className="data-pill bg-accent/10 text-accent">
            Protecting {room}
          </span>
        ))}
        {actionScope.length > 0 ? (
          <span className="data-pill bg-stone-900/5 text-stone-700">Scope: {actionScope.join(", ")}</span>
        ) : null}
      </div>

      <motion.div
        key={activeStepLabel}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute bottom-5 left-5 z-10 rounded-2xl border border-stone-900/10 bg-stone-100/80 px-4 py-3 text-sm text-stone-700 backdrop-blur"
      >
        {homeState ? (
          <button
            type="button"
            className="cursor-pointer font-medium text-stone-800 underline decoration-dotted underline-offset-4"
            onClick={() => setShowActiveDevices((current) => !current)}
          >
            {activeDevices.length} active devices
          </button>
        ) : (
          "Booting house model"
        )}
      </motion.div>

      {showActiveDevices && homeState ? (
        <div className="absolute bottom-20 left-5 z-10 w-[320px] rounded-3xl border border-stone-900/10 bg-stone-50/95 p-4 shadow-xl backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-stone-500">Active Devices</div>
            <button type="button" className="text-sm text-stone-500" onClick={() => setShowActiveDevices(false)}>
              Close
            </button>
          </div>
          <div className="space-y-2">
            {activeDevices.map((device) => (
              <div key={device.id} className="rounded-2xl bg-stone-900/5 px-3 py-2 text-sm text-stone-700">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-stone-900">{device.name}</span>
                  <span>{device.room}</span>
                </div>
                <div className="mt-1 text-xs uppercase tracking-[0.16em] text-stone-500">
                  {device.type} · {device.type === "ev_charger" ? device.state.charger_status : `${Math.round(device.power_watts)} W max`}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Canvas shadows camera={{ position: [9, 11, 13], fov: 44 }}>
        <color attach="background" args={["#f0ede6"]} />
        <ambientLight intensity={1.0} />
        <directionalLight
          castShadow
          color="#fff8f2"
          position={[10, 14, 8]}
          intensity={1.5}
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        {homeState ? (
          <HouseModel homeState={homeState} protectedRooms={protectedRooms} onDeviceToggle={onDeviceToggle} />
        ) : null}
        <Environment preset="apartment" />
        <OrbitControls
          enablePan={false}
          minPolarAngle={0.6}
          maxPolarAngle={1.35}
          minDistance={10}
          maxDistance={24}
        />
      </Canvas>
    </div>
  );
}
