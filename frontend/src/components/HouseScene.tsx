import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import { motion } from "framer-motion";
import type { HomeState } from "../types";
import { RoomShell } from "./house/RoomShell";
import { EVCharger, Fan, Fridge, Lamp, PorchLight, ScreenDevice } from "./house/devices";

interface HouseSceneProps {
  homeState: HomeState | null;
  activeStepLabel: string;
}

function findDevice(homeState: HomeState, deviceId: string) {
  return homeState.devices.find((device) => device.id === deviceId);
}

function HouseModel({ homeState }: { homeState: HomeState }) {
  const livingLamp = findDevice(homeState, "living_room_lamp");
  const livingTv = findDevice(homeState, "living_room_tv");
  const kitchenLight = findDevice(homeState, "kitchen_ceiling_light");
  const bedroomLamp = findDevice(homeState, "bedroom_lamp");
  const bedroomFan = findDevice(homeState, "bedroom_fan");
  const officeMonitor = findDevice(homeState, "office_monitor");
  const smartPlugLamp = findDevice(homeState, "office_demo_plug_lamp");
  const charger = findDevice(homeState, "garage_ev_charger");
  const porchLight = findDevice(homeState, "porch_light");

  return (
    <group position={[0, 0.4, 0]}>
      <RoomShell position={[-3.1, 1.2, -1.6]} size={[3.4, 2.4, 2.8]} label="Living Room" accent="#10253c">
        <Lamp position={[-0.8, -0.95, 0.1]} isOn={Boolean(livingLamp?.state.is_on)} brightness={livingLamp?.state.brightness} />
        <ScreenDevice position={[0.95, -1.08, -0.3]} isOn={Boolean(livingTv?.state.screen_on)} width={1.1} />
      </RoomShell>

      <RoomShell position={[0.2, 1.2, -1.6]} size={[3, 2.4, 2.8]} label="Kitchen" accent="#14304d">
        <Lamp position={[-0.55, -0.95, 0.5]} isOn={Boolean(kitchenLight?.state.is_on)} brightness={kitchenLight?.state.brightness} />
        <Fridge position={[0.95, -1.15, -0.25]} />
        <mesh position={[-0.1, -1.08, -0.4]} castShadow>
          <boxGeometry args={[1.3, 0.18, 0.7]} />
          <meshStandardMaterial color="#475569" />
        </mesh>
      </RoomShell>

      <RoomShell position={[-3.1, 1.2, 1.45]} size={[3.4, 2.4, 2.5]} label="Bedroom" accent="#132743">
        <Lamp position={[-0.9, -0.95, 0.25]} isOn={Boolean(bedroomLamp?.state.is_on)} brightness={bedroomLamp?.state.brightness} color="#fca5a5" />
        <Fan position={[0.7, -1.05, -0.25]} rpm={bedroomFan?.state.rotation_rpm ?? 0} />
        <mesh position={[-0.15, -1.05, -0.2]} castShadow>
          <boxGeometry args={[1.5, 0.25, 0.85]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
      </RoomShell>

      <RoomShell position={[0.2, 1.2, 1.45]} size={[3, 2.4, 2.5]} label="Office" accent="#0f2844">
        <ScreenDevice position={[0.75, -1.08, -0.18]} isOn={Boolean(officeMonitor?.state.screen_on)} width={0.82} />
        <Lamp position={[-0.75, -0.95, 0.3]} isOn={Boolean(smartPlugLamp?.state.is_on)} brightness={smartPlugLamp?.state.brightness} color="#5eead4" />
        <mesh position={[0.6, -1.08, -0.28]} castShadow>
          <boxGeometry args={[1.1, 0.12, 0.65]} />
          <meshStandardMaterial color="#475569" />
        </mesh>
      </RoomShell>

      <RoomShell position={[3.1, 1.2, -0.1]} size={[2.2, 2.4, 5.7]} label="Garage" accent="#112235">
        <EVCharger position={[0.2, -1.08, 0.5]} status={charger?.state.charger_status ?? "paused"} />
        <mesh position={[0, -1.08, -0.85]} castShadow>
          <boxGeometry args={[1.6, 0.18, 2.3]} />
          <meshStandardMaterial color="#1f2937" />
        </mesh>
      </RoomShell>

      <PorchLight
        position={[1.45, 1.5, 2.95]}
        isOn={Boolean(porchLight?.state.is_on)}
        brightness={porchLight?.state.brightness}
        scheduled={porchLight?.state.scheduled}
      />
      <mesh position={[0.3, -0.05, 0.2]} receiveShadow>
        <boxGeometry args={[10.5, 0.1, 7.5]} />
        <meshStandardMaterial color="#0b1422" />
      </mesh>
    </group>
  );
}

export function HouseScene({ homeState, activeStepLabel }: HouseSceneProps) {
  return (
    <div className="panel relative h-[520px] overflow-hidden">
      <div className="absolute left-5 top-5 z-10 flex flex-wrap gap-2">
        <span className="data-pill bg-accent/10 text-accent">{homeState?.mode_label ?? "Loading"}</span>
        <span className="data-pill">{activeStepLabel}</span>
      </div>

      <motion.div
        key={activeStepLabel}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute bottom-5 left-5 z-10 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-200 backdrop-blur"
      >
        {homeState ? `${homeState.devices.filter((device) => device.state.is_on).length} active devices` : "Booting house model"}
      </motion.div>

      <Canvas shadows camera={{ position: [9, 7.5, 10], fov: 42 }}>
        <color attach="background" args={["#07111f"]} />
        <ambientLight intensity={0.8} />
        <directionalLight castShadow position={[10, 12, 8]} intensity={1.8} shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
        {homeState ? <HouseModel homeState={homeState} /> : null}
        <Environment preset="night" />
        <OrbitControls enablePan={false} minPolarAngle={0.8} maxPolarAngle={1.2} minDistance={12} maxDistance={16} />
      </Canvas>
    </div>
  );
}
