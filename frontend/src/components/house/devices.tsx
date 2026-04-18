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
}: {
  position: [number, number, number];
  isOn: boolean;
  brightness?: number | null;
  color?: string;
  badge?: string;
}) {
  const lightRef = useRef<PointLight>(null);
  const bulbRef = useRef<Mesh>(null);
  const targetIntensity = isOn ? 1.8 * (brightness ?? 1) : 0;
  useLerpLight(lightRef, targetIntensity);
  useLerpEmissive(bulbRef, isOn ? 2.5 * (brightness ?? 1) : 0, color);

  return (
    <group position={position}>
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
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.08, 0.35, 16]} />
        <meshStandardMaterial color="#8a7a6a" />
      </mesh>
      <group ref={groupRef} position={[0, 0.48, 0]}>
        {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((rotation) => (
          <mesh key={rotation} rotation={[0, rotation, 0]} castShadow>
            <boxGeometry args={[0.75, 0.03, 0.12]} />
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
      <mesh position={[0, 0.28, 0]} castShadow>
        <boxGeometry args={[0.18, 0.45, 0.12]} />
        <meshStandardMaterial color="#6b5c4a" roughness={0.5} />
      </mesh>
      <mesh ref={bulbRef} position={[0, 0.22, 0.08]} castShadow>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial
          color={isOn ? "#fff7c2" : "#c8bfb0"}
          emissive={scheduled ? "#c17a3a" : "#fde68a"}
          emissiveIntensity={0}
        />
      </mesh>
      <pointLight ref={lightRef} position={[0, 0.22, 0.35]} distance={2.2} intensity={0} color="#fde68a" />
    </group>
  );
}
