import { Text } from "@react-three/drei";
import type { ReactNode } from "react";

interface RoomShellProps {
  position: [number, number, number];
  size: [number, number, number];
  label: string;
  children?: ReactNode;
  accent?: string;
  highlighted?: boolean;
}

export function RoomShell({ position, size, label, children, accent = "#b8956a", highlighted = false }: RoomShellProps) {
  const [width, height, depth] = size;

  return (
    <group position={position}>
      {highlighted ? (
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[width + 0.14, height + 0.14, depth + 0.14]} />
          <meshStandardMaterial color="#5eead4" transparent opacity={0.1} emissive="#5eead4" emissiveIntensity={0.4} />
        </mesh>
      ) : null}
      {/* Floor */}
      <mesh position={[0, -height / 2, 0]} receiveShadow>
        <boxGeometry args={[width, 0.15, depth]} />
        <meshStandardMaterial color={accent} roughness={0.7} />
      </mesh>
      {/* Left wall */}
      <mesh position={[-width / 2, 0, 0]} receiveShadow>
        <boxGeometry args={[0.15, height, depth]} />
        <meshStandardMaterial color="#c8bfb2" roughness={0.6} />
      </mesh>
      {/* Back wall */}
      <mesh position={[0, 0, -depth / 2]} receiveShadow>
        <boxGeometry args={[width, height, 0.15]} />
        <meshStandardMaterial color="#c0b7aa" roughness={0.6} />
      </mesh>
      {/* Ceiling */}
      <mesh position={[0, height / 2 + 0.15, 0]} receiveShadow>
        <boxGeometry args={[width, 0.1, depth]} />
        <meshStandardMaterial color="#e8e2da" roughness={0.5} />
      </mesh>
      <Text
        position={[0, height / 2 + 0.3, depth / 2 - 0.3]}
        fontSize={0.28}
        color={highlighted ? "#0f766e" : "#5c4a3a"}
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
      {children}
    </group>
  );
}
