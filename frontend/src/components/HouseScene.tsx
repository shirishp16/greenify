import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls, Text } from "@react-three/drei";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import type { HomeState } from "../types";
import { RoomShell } from "./house/RoomShell";
import { ChargingCable, Dishwasher, Dryer, EVCharger, Fan, Fridge, HVACUnit, Lamp, PorchLight, ScreenDevice, TeslaCar, Washer } from "./house/devices";

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
  const hvac = findDevice(homeState, "central_hvac");
  const officeMonitor = findDevice(homeState, "office_monitor");
  const smartPlugLamp = findDevice(homeState, "office_demo_plug_lamp");
  const charger = findDevice(homeState, "garage_ev_charger");
  const porchLight = findDevice(homeState, "porch_light");
  const dishwasher = findDevice(homeState, "kitchen_dishwasher");
  const washer = findDevice(homeState, "laundry_washer");
  const dryer = findDevice(homeState, "laundry_dryer");
  const evIsCharging = charger?.state.charger_status === "charging";

  return (
    <group position={[0, -0.38, 0]}>
      {/* ── FIRST FLOOR ── */}
      <RoomShell
        position={[-3.35, 1.15, -1.65]}
        size={[3.5, 2.45, 2.9]}
        label="Living Room"
        accent="#b8956a"
        highlighted={protectedRooms.includes("living room")}
        labelPosition="front"
      >
        <Lamp
          position={[-1.1, -1.15, 0.65]}
          isOn={Boolean(livingLamp?.state.is_on)}
          brightness={livingLamp?.state.brightness}
        />
        <ScreenDevice position={[1.0, -1.13, -0.85]} isOn={Boolean(livingTv?.state.screen_on)} width={1.05} />
        {/* Sofa */}
        <mesh position={[-0.15, -0.98, 0.45]} castShadow>
          <boxGeometry args={[1.6, 0.34, 0.72]} />
          <meshStandardMaterial color="#a08060" roughness={0.8} />
        </mesh>
      </RoomShell>

      <RoomShell
        position={[0.2, 1.15, -1.65]}
        size={[3.1, 2.45, 2.9]}
        label="Kitchen"
        accent="#adb38a"
        highlighted={protectedRooms.includes("kitchen")}
        labelPosition="front"
      >
        <Lamp
          position={[-1.0, -1.15, 0.75]}
          isOn={Boolean(kitchenLight?.state.is_on)}
          brightness={kitchenLight?.state.brightness}
        />
        <Fridge position={[1.05, -1.15, -0.9]} />
        <Dishwasher position={[-1.0, -1.16, -0.78]} isOn={Boolean(dishwasher?.state.is_on)} />
        {/* Counter */}
        <mesh position={[0.0, -1.03, -0.62]} castShadow>
          <boxGeometry args={[1.55, 0.22, 0.75]} />
          <meshStandardMaterial color="#8a7a6a" roughness={0.6} />
        </mesh>
      </RoomShell>

      {/* ── SECOND FLOOR ── */}
      <RoomShell
        position={[-3.35, 3.9, -1.65]}
        size={[3.5, 2.45, 2.9]}
        label="Bedroom"
        accent="#c49a7a"
        highlighted={protectedRooms.includes("bedroom")}
      >
        <Lamp
          position={[-1.08, -1.15, 0.72]}
          isOn={Boolean(bedroomLamp?.state.is_on)}
          brightness={bedroomLamp?.state.brightness}
          color="#fca5a5"
        />
        <Fan position={[0.55, 1.28, -0.05]} rpm={bedroomFan?.state.rotation_rpm ?? 0} />
        {/* Bed */}
        <mesh position={[-0.15, -1.02, -0.45]} castShadow>
          <boxGeometry args={[1.55, 0.26, 0.9]} />
          <meshStandardMaterial color="#7a5c4a" roughness={0.7} />
        </mesh>
      </RoomShell>

      <RoomShell
        position={[0.2, 3.9, -1.65]}
        size={[3.1, 2.45, 2.9]}
        label="Office"
        accent="#9aab8a"
        highlighted={protectedRooms.includes("office")}
      >
        <ScreenDevice position={[0.95, -0.93, -0.68]} isOn={Boolean(officeMonitor?.state.screen_on)} width={0.82} />
        <Lamp
          position={[-0.2, -0.92, -0.68]}
          isOn={Boolean(smartPlugLamp?.state.is_on)}
          brightness={smartPlugLamp?.state.brightness}
          color="#5eead4"
          badge="Smart Plug"
          onClick={
            onDeviceToggle && smartPlugLamp ? () => onDeviceToggle(smartPlugLamp.id) : undefined
          }
        />
        {/* Desk top */}
        <mesh position={[0.38, -1.0, -0.78]} castShadow>
          <boxGeometry args={[2.0, 0.08, 0.82]} />
          <meshStandardMaterial color="#8b7355" roughness={0.58} />
        </mesh>
        {/* Desk legs */}
        {[
          [-0.5, -1.2, -1.1],
          [1.2, -1.2, -1.1],
          [-0.5, -1.2, -0.46],
          [1.2, -1.2, -0.46],
        ].map((legPos) => (
          <mesh key={legPos.join(",")} position={legPos as [number, number, number]} castShadow>
            <boxGeometry args={[0.09, 0.38, 0.09]} />
            <meshStandardMaterial color="#78624d" roughness={0.62} />
          </mesh>
        ))}
        {/* Chair */}
        <mesh position={[0.45, -1.15, 0.12]} castShadow>
          <boxGeometry args={[0.55, 0.12, 0.5]} />
          <meshStandardMaterial color="#6f7a83" roughness={0.62} />
        </mesh>
        <mesh position={[0.45, -0.96, -0.1]} castShadow>
          <boxGeometry args={[0.5, 0.32, 0.09]} />
          <meshStandardMaterial color="#6f7a83" roughness={0.62} />
        </mesh>
      </RoomShell>

      {/* ── LAUNDRY (second floor, right of Office) ── */}
      <RoomShell position={[2.65, 3.9, -1.65]} size={[1.8, 2.45, 2.9]} label="Laundry" accent="#9090a8">
        <Washer position={[-0.42, -1.16, -0.65]} isOn={Boolean(washer?.state.is_on)} />
        <Dryer position={[0.42, -1.16, -0.65]} isOn={Boolean(dryer?.state.is_on)} />
      </RoomShell>

      {/* ── GARAGE (first floor, right wing) ── */}
      <RoomShell
        position={[3.45, 1.15, -0.2]}
        size={[2.25, 2.45, 5.4]}
        label="Garage"
        accent="#a0a09a"
        highlighted={protectedRooms.includes("garage")}
        labelPosition="front"
      >
        <EVCharger position={[0.95, -1.15, 1.35]} status={charger?.state.charger_status ?? "paused"} />
        <TeslaCar position={[-0.1, -1.17, -0.68]} isCharging={evIsCharging} />
        <ChargingCable
          start={[1.07, -0.42, 1.56]}
          end={[0.77, -0.61, -1.71]}
          active={evIsCharging}
        />
        {/* Garage floor mat */}
        <mesh position={[0, -1.05, -0.25]} castShadow>
          <boxGeometry args={[1.65, 0.12, 2.85]} />
          <meshStandardMaterial color="#9a9890" roughness={0.8} />
        </mesh>
        {/* Storage shelf */}
        <mesh position={[-0.55, -1.0, -1.82]} castShadow>
          <boxGeometry args={[0.58, 0.45, 0.88]} />
          <meshStandardMaterial color="#8c857d" roughness={0.75} />
        </mesh>
      </RoomShell>

      {/* Porch Light */}
      <group position={[0.9, 0.14, 1.95]}>
        {/* Entry wall */}
        <mesh position={[0, 1.05, 0]} castShadow>
          <boxGeometry args={[2.35, 2.1, 0.16]} />
          <meshStandardMaterial color="#c7b8a2" roughness={0.72} />
        </mesh>
        {/* Door inset */}
        <mesh position={[-0.6, 0.92, 0.09]} castShadow>
          <boxGeometry args={[0.82, 1.75, 0.05]} />
          <meshStandardMaterial color="#8a6b54" roughness={0.6} />
        </mesh>
        {/* Porch awning */}
        <mesh position={[0, 2.02, 0.32]} castShadow>
          <boxGeometry args={[2.55, 0.12, 0.9]} />
          <meshStandardMaterial color="#bda990" roughness={0.7} />
        </mesh>
        <Text
          position={[0, 2.34, 0.58]}
          fontSize={0.24}
          color="#5c4a3a"
          anchorX="center"
          anchorY="middle"
        >
          Porch
        </Text>
      </group>
      <PorchLight
        position={[1.38, 1.26, 1.9]}
        isOn={Boolean(porchLight?.state.is_on)}
        brightness={porchLight?.state.brightness}
        scheduled={porchLight?.state.scheduled}
      />

      <HVACUnit position={[4.2, 0.3, 2.5]} isOn={Boolean(hvac?.state.is_on)} />

      {/* Ground slab */}
      <mesh position={[0.35, -0.08, 0.2]} receiveShadow>
        <boxGeometry args={[11, 0.12, 8]} />
        <meshStandardMaterial color="#c8bfb0" roughness={0.8} />
      </mesh>
      {/* Front walkway */}
      <mesh position={[0.95, -0.02, 2.35]} receiveShadow>
        <boxGeometry args={[2.8, 0.04, 2.1]} />
        <meshStandardMaterial color="#d7cbb8" roughness={0.85} />
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
        <span className="data-pill bg-accent/15 text-accent">Prompt-Driven State</span>
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
