import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { useRef } from "react";
import type { Group, Mesh, PointLight } from "three";
import { Color } from "three";

function useLerpLight(lightRef: React.RefObject<PointLight | null>, targetIntensity: number) {
  useFrame(() => {
    if (!lightRef.current) {
      return;
    }
    lightRef.current.intensity += (targetIntensity - lightRef.current.intensity) * 0.08;
  });
}

function useLerpEmissive(meshRef: React.RefObject<Mesh | null>, target: number, onColor: string) {
  useFrame(() => {
    const material = meshRef.current?.material;
    if (!material || !("emissiveIntensity" in material) || !("emissive" in material)) {
      return;
    }
    const emissiveMaterial = material as Mesh["material"] & {
      emissive: Color;
      emissiveIntensity: number;
    };
    emissiveMaterial.emissive = new Color(onColor);
    emissiveMaterial.emissiveIntensity += (target - emissiveMaterial.emissiveIntensity) * 0.08;
  });
}

export function Lamp({
  position,
  isOn,
  brightness = 1,
  color = "#fef08a",
  badge,
  onClick,
}: {
  position: [number, number, number];
  isOn: boolean;
  brightness?: number | null;
  color?: string;
  badge?: string;
  onClick?: () => void;
}) {
  const lightRef = useRef<PointLight>(null);
  const bulbRef = useRef<Mesh>(null);
  const targetIntensity = isOn ? 1.8 * (brightness ?? 1) : 0;
  useLerpLight(lightRef, targetIntensity);
  useLerpEmissive(bulbRef, isOn ? 2.5 * (brightness ?? 1) : 0, color);

  const interactive = Boolean(onClick);

  return (
    <group
      position={position}
      onClick={
        onClick
          ? (event) => {
              event.stopPropagation();
              onClick();
            }
          : undefined
      }
      onPointerOver={
        interactive
          ? (event) => {
              event.stopPropagation();
              document.body.style.cursor = "pointer";
            }
          : undefined
      }
      onPointerOut={
        interactive
          ? () => {
              document.body.style.cursor = "auto";
            }
          : undefined
      }
    >
      <mesh position={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.08, 0.7, 16]} />
        <meshStandardMaterial color="#7a6655" metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh ref={bulbRef} position={[0, 0.82, 0]} castShadow>
        <sphereGeometry args={[0.14, 16, 16]} />
        <meshStandardMaterial color={isOn ? "#fff7c2" : "#c8bfb0"} emissive={color} emissiveIntensity={0} />
      </mesh>
      {badge ? (
        <Text position={[0, 1.2, 0]} fontSize={0.13} color="#0f766e" anchorX="center" anchorY="middle">
          {badge}
        </Text>
      ) : null}
      <pointLight ref={lightRef} position={[0, 1, 0]} distance={3.2} intensity={0} color={color} />
    </group>
  );
}

export function ScreenDevice({
  position,
  isOn,
  width = 0.95,
}: {
  position: [number, number, number];
  isOn: boolean;
  width?: number;
}) {
  const screenRef = useRef<Mesh>(null);
  useLerpEmissive(screenRef, isOn ? 2 : 0, "#38bdf8");

  return (
    <group position={position}>
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[width, 0.55, 0.08]} />
        <meshStandardMaterial color="#111827" />
      </mesh>
      <mesh ref={screenRef} position={[0, 0.45, 0.05]} castShadow>
        <boxGeometry args={[width * 0.88, 0.42, 0.02]} />
        <meshStandardMaterial color={isOn ? "#0f172a" : "#020617"} emissive="#38bdf8" emissiveIntensity={0} />
      </mesh>
      <mesh position={[0, 0.1, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.05, 0.25, 12]} />
        <meshStandardMaterial color="#8a7a6a" />
      </mesh>
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[0.35, 0.04, 0.2]} />
        <meshStandardMaterial color="#7a5c4a" />
      </mesh>
    </group>
  );
}

export function Fan({
  position,
  rpm,
}: {
  position: [number, number, number];
  rpm: number;
}) {
  const groupRef = useRef<Group>(null);

  useFrame((_state, delta) => {
    if (!groupRef.current) {
      return;
    }
    const targetSpeed = rpm > 0 ? (rpm / 60) * Math.PI * 2 : 0;
    groupRef.current.rotation.y += targetSpeed * delta;
  });

  return (
    <group position={position}>
      {/* Ceiling canopy */}
      <mesh position={[0, 0, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.18, 0.08, 18]} />
        <meshStandardMaterial color="#8a7a6a" roughness={0.45} metalness={0.2} />
      </mesh>
      {/* Downrod */}
      <mesh position={[0, -0.28, 0]} castShadow>
        <cylinderGeometry args={[0.025, 0.025, 0.5, 12]} />
        <meshStandardMaterial color="#756555" roughness={0.45} />
      </mesh>
      {/* Motor housing */}
      <mesh position={[0, -0.56, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.12, 0.2, 16]} />
        <meshStandardMaterial color="#8a7a6a" />
      </mesh>
      {/* Blade hub + blades */}
      <group ref={groupRef} position={[0, -0.65, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.08, 0.08, 0.08, 14]} />
          <meshStandardMaterial color="#6c5a4d" roughness={0.45} />
        </mesh>
        {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((rotation) => (
          <mesh key={rotation} rotation={[0, rotation, 0]} castShadow>
            <boxGeometry args={[0.9, 0.025, 0.14]} />
            <meshStandardMaterial color={rpm > 0 ? "#4a7c59" : "#8a7a6a"} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function Fridge({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.7, 0]} castShadow>
        <boxGeometry args={[0.7, 1.4, 0.75]} />
        <meshStandardMaterial color="#e8e2da" roughness={0.4} />
      </mesh>
      <mesh position={[0.29, 0.82, 0.3]} castShadow>
        <boxGeometry args={[0.04, 0.32, 0.04]} />
        <meshStandardMaterial color="#8a7a6a" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.15, 0.38]} castShadow>
        <boxGeometry args={[0.08, 0.08, 0.04]} />
        <meshStandardMaterial color="#4a7c59" emissive="#4a7c59" emissiveIntensity={1.2} />
      </mesh>
    </group>
  );
}

export function EVCharger({
  position,
  status,
}: {
  position: [number, number, number];
  status: string;
}) {
  const ringRef = useRef<Mesh>(null);
  useLerpEmissive(ringRef, status === "charging" ? 2.5 : 0.35, status === "charging" ? "#4a7c59" : "#c17a3a");

  return (
    <group position={position}>
      <mesh position={[0, 0.7, 0]} castShadow>
        <boxGeometry args={[0.5, 1.4, 0.4]} />
        <meshStandardMaterial color="#2c3630" roughness={0.5} />
      </mesh>
      <mesh ref={ringRef} position={[0, 0.92, 0.21]} castShadow>
        <torusGeometry args={[0.12, 0.04, 12, 24]} />
        <meshStandardMaterial color="#1a2420" emissive="#4a7c59" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[0.22, 0.3, 0]} rotation={[0, 0, 0.35]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.65, 10]} />
        <meshStandardMaterial color="#1a2420" />
      </mesh>
    </group>
  );
}

export function HVACUnit({
  position,
  isOn,
}: {
  position: [number, number, number];
  isOn: boolean;
}) {
  const fanRef = useRef<Group>(null);
  const ringRef = useRef<Mesh>(null);
  const glowRef = useRef<PointLight>(null);

  useFrame((_state, delta) => {
    if (!fanRef.current) {
      return;
    }
    const targetSpeed = isOn ? Math.PI * 4 : 0;
    fanRef.current.rotation.z += targetSpeed * delta;
  });

  useLerpEmissive(ringRef, isOn ? 1.8 : 0, isOn ? "#38bdf8" : "#64748b");
  useLerpLight(glowRef, isOn ? 1.2 : 0);

  return (
    <group position={position}>
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[1, 0.9, 0.65]} />
        <meshStandardMaterial color="#cfd6dc" roughness={0.45} metalness={0.15} />
      </mesh>
      <mesh ref={ringRef} position={[0, 0.45, 0.33]} castShadow>
        <torusGeometry args={[0.22, 0.035, 16, 32]} />
        <meshStandardMaterial color="#334155" emissive="#38bdf8" emissiveIntensity={0} />
      </mesh>
      <group ref={fanRef} position={[0, 0.45, 0.34]}>
        {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((rotation) => (
          <mesh key={rotation} rotation={[0, 0, rotation]} castShadow>
            <boxGeometry args={[0.28, 0.04, 0.02]} />
            <meshStandardMaterial color={isOn ? "#475569" : "#94a3b8"} />
          </mesh>
        ))}
      </group>
      <pointLight ref={glowRef} position={[0, 0.45, 0.8]} distance={2.6} intensity={0} color="#7dd3fc" />
    </group>
  );
}

export function TeslaCar({
  position,
  isCharging,
}: {
  position: [number, number, number];
  isCharging: boolean;
}) {
  const accentRef = useRef<Mesh>(null);
  useLerpEmissive(accentRef, isCharging ? 1.6 : 0.2, isCharging ? "#38bdf8" : "#64748b");

  return (
    <group position={position}>
      <mesh position={[0, 0.34, 0]} castShadow>
        <boxGeometry args={[1.45, 0.38, 2.5]} />
        <meshStandardMaterial color="#d7dce2" metalness={0.35} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.62, -0.05]} castShadow>
        <boxGeometry args={[1.2, 0.28, 1.25]} />
        <meshStandardMaterial color="#c2c9d1" metalness={0.3} roughness={0.28} />
      </mesh>
      <mesh ref={accentRef} position={[0.55, 0.34, 1.12]} castShadow>
        <boxGeometry args={[0.08, 0.08, 0.08]} />
        <meshStandardMaterial color="#1e293b" emissive="#38bdf8" emissiveIntensity={0} />
      </mesh>
      {[
        [-0.58, 0.1, -0.82],
        [0.58, 0.1, -0.82],
        [-0.58, 0.1, 0.82],
        [0.58, 0.1, 0.82],
      ].map((wheel) => (
        <mesh key={wheel.join(",")} position={wheel as [number, number, number]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.18, 0.18, 0.14, 20]} />
          <meshStandardMaterial color="#1f2937" roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

export function ChargingCable({
  start,
  end,
  active,
}: {
  start: [number, number, number];
  end: [number, number, number];
  active: boolean;
}) {
  const mid: [number, number, number] = [
    (start[0] + end[0]) / 2,
    Math.max(start[1], end[1]) + 0.2,
    (start[2] + end[2]) / 2,
  ];

  return (
    <group>
      {[start, mid, end].map((point, index) => (
        <mesh key={`${point.join(",")}-${index}`} position={point} castShadow>
          <sphereGeometry args={[0.035, 12, 12]} />
          <meshStandardMaterial color={active ? "#38bdf8" : "#475569"} emissive={active ? "#38bdf8" : "#000000"} emissiveIntensity={active ? 0.7 : 0} />
        </mesh>
      ))}
      <mesh position={mid} castShadow>
        <boxGeometry args={[0.05, 0.05, Math.hypot(end[2] - start[2], end[0] - start[0])]} />
        <meshStandardMaterial color={active ? "#0f172a" : "#334155"} />
      </mesh>
    </group>
  );
}

export function Washer({
  position,
  isOn,
}: {
  position: [number, number, number];
  isOn: boolean;
}) {
  const indicatorRef = useRef<Mesh>(null);
  useLerpEmissive(indicatorRef, isOn ? 2.5 : 0, "#4a7c59");

  return (
    <group position={position}>
      {/* Body */}
      <mesh position={[0, 0.32, 0]} castShadow>
        <boxGeometry args={[0.55, 0.62, 0.52]} />
        <meshStandardMaterial color="#e8e2da" roughness={0.4} />
      </mesh>
      {/* Porthole ring */}
      <mesh position={[0, 0.34, 0.265]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.14, 0.025, 12, 24]} />
        <meshStandardMaterial color="#8a7a6a" metalness={0.4} roughness={0.4} />
      </mesh>
      {/* Porthole glass */}
      <mesh position={[0, 0.34, 0.268]}>
        <circleGeometry args={[0.11, 24]} />
        <meshStandardMaterial color={isOn ? "#6a9ab8" : "#3a4a5a"} roughness={0.1} metalness={0.2} />
      </mesh>
      {/* Control panel top */}
      <mesh position={[0, 0.66, 0.12]} castShadow>
        <boxGeometry args={[0.45, 0.05, 0.24]} />
        <meshStandardMaterial color="#ccc8c0" roughness={0.4} />
      </mesh>
      {/* Status LED */}
      <mesh ref={indicatorRef} position={[0.16, 0.66, 0.25]}>
        <boxGeometry args={[0.04, 0.04, 0.02]} />
        <meshStandardMaterial color="#1a2420" emissive="#4a7c59" emissiveIntensity={0} />
      </mesh>
    </group>
  );
}

export function Dryer({
  position,
  isOn,
}: {
  position: [number, number, number];
  isOn: boolean;
}) {
  const indicatorRef = useRef<Mesh>(null);
  useLerpEmissive(indicatorRef, isOn ? 2.5 : 0, "#4a7c59");

  return (
    <group position={position}>
      {/* Body — slightly warmer tone to distinguish from washer */}
      <mesh position={[0, 0.32, 0]} castShadow>
        <boxGeometry args={[0.55, 0.62, 0.52]} />
        <meshStandardMaterial color="#ddd8d0" roughness={0.4} />
      </mesh>
      {/* Circular door ring — larger, flatter torus */}
      <mesh position={[0, 0.32, 0.265]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.16, 0.02, 12, 24]} />
        <meshStandardMaterial color="#7a6a5a" metalness={0.3} roughness={0.5} />
      </mesh>
      {/* Vent slots — three thin horizontal bars */}
      {([-0.06, 0, 0.06] as const).map((ox) => (
        <mesh key={ox} position={[ox, 0.32, 0.266]} castShadow>
          <boxGeometry args={[0.025, 0.11, 0.015]} />
          <meshStandardMaterial color="#5a4a3a" />
        </mesh>
      ))}
      {/* Control panel top */}
      <mesh position={[0, 0.66, 0.12]} castShadow>
        <boxGeometry args={[0.45, 0.05, 0.24]} />
        <meshStandardMaterial color="#c8c4bc" roughness={0.4} />
      </mesh>
      {/* Status LED */}
      <mesh ref={indicatorRef} position={[0.16, 0.66, 0.25]}>
        <boxGeometry args={[0.04, 0.04, 0.02]} />
        <meshStandardMaterial color="#1a2420" emissive="#4a7c59" emissiveIntensity={0} />
      </mesh>
    </group>
  );
}

export function Dishwasher({
  position,
  isOn,
}: {
  position: [number, number, number];
  isOn: boolean;
}) {
  const indicatorRef = useRef<Mesh>(null);
  useLerpEmissive(indicatorRef, isOn ? 2.5 : 0, "#4a7c59");

  return (
    <group position={position}>
      {/* Body — under-counter height, slightly narrower */}
      <mesh position={[0, 0.38, 0]} castShadow>
        <boxGeometry args={[0.52, 0.75, 0.50]} />
        <meshStandardMaterial color="#e0dbd2" roughness={0.4} />
      </mesh>
      {/* Door handle — horizontal bar */}
      <mesh position={[0, 0.54, 0.26]} castShadow>
        <boxGeometry args={[0.38, 0.04, 0.04]} />
        <meshStandardMaterial color="#8a7a6a" metalness={0.3} roughness={0.4} />
      </mesh>
      {/* Control panel strip near top */}
      <mesh position={[0, 0.76, 0.16]} castShadow>
        <boxGeometry args={[0.42, 0.05, 0.16]} />
        <meshStandardMaterial color="#c0bbb4" roughness={0.4} />
      </mesh>
      {/* Status LED */}
      <mesh ref={indicatorRef} position={[0.15, 0.76, 0.25]}>
        <boxGeometry args={[0.04, 0.04, 0.02]} />
        <meshStandardMaterial color="#1a2420" emissive="#4a7c59" emissiveIntensity={0} />
      </mesh>
    </group>
  );
}

export function PorchLight({
  position,
  isOn,
  brightness = 0.6,
  scheduled = false,
}: {
  position: [number, number, number];
  isOn: boolean;
  brightness?: number | null;
  scheduled?: boolean;
}) {
  const lightRef = useRef<PointLight>(null);
  const bulbRef = useRef<Mesh>(null);
  const targetIntensity = isOn ? 1.4 * (brightness ?? 0.6) : 0;
  useLerpLight(lightRef, targetIntensity);
  useLerpEmissive(bulbRef, isOn ? 1.8 : 0, scheduled ? "#c17a3a" : "#fde68a");

  return (
    <group position={position}>
      {/* Wall backplate */}
      <mesh position={[0, 0.24, -0.06]} castShadow>
        <boxGeometry args={[0.24, 0.56, 0.05]} />
        <meshStandardMaterial color="#5b4c3f" roughness={0.55} />
      </mesh>
      {/* Mount arm */}
      <mesh position={[0, 0.24, 0.02]} castShadow>
        <boxGeometry args={[0.06, 0.06, 0.16]} />
        <meshStandardMaterial color="#6b5c4a" roughness={0.52} />
      </mesh>
      {/* Lantern body */}
      <mesh position={[0, 0.24, 0.15]} castShadow>
        <boxGeometry args={[0.2, 0.4, 0.14]} />
        <meshStandardMaterial color="#6b5c4a" roughness={0.5} />
      </mesh>
      <mesh ref={bulbRef} position={[0, 0.2, 0.17]} castShadow>
        <sphereGeometry args={[0.085, 16, 16]} />
        <meshStandardMaterial
          color={isOn ? "#fff7c2" : "#c8bfb0"}
          emissive={scheduled ? "#c17a3a" : "#fde68a"}
          emissiveIntensity={0}
        />
      </mesh>
      <pointLight ref={lightRef} position={[0, 0.18, 0.42]} distance={2.4} intensity={0} color="#fde68a" />
    </group>
  );
}
