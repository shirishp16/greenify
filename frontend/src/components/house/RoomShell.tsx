import { Text } from "@react-three/drei";
import type { ReactNode } from "react";

interface RoomShellProps {
  position: [number, number, number];
  size: [number, number, number];
  label: string;
  children?: ReactNode;
  accent?: string;
}

export function RoomShell({ position, size, label, children, accent = "#10253c" }: RoomShellProps) {
  const [width, height, depth] = size;

  return (
    <group position={position}>
      <mesh position={[0, -height / 2, 0]} receiveShadow>
        <boxGeometry args={[width, 0.15, depth]} />
        <meshStandardMaterial color={accent} />
      </mesh>
      <mesh position={[-width / 2, 0, 0]} receiveShadow>
        <boxGeometry args={[0.15, height, depth]} />
        <meshStandardMaterial color="#18314f" />
      </mesh>
      <mesh position={[0, 0, -depth / 2]} receiveShadow>
        <boxGeometry args={[width, height, 0.15]} />
        <meshStandardMaterial color="#14263f" />
      </mesh>
      <mesh position={[0, height / 2 + 0.15, 0]} receiveShadow>
        <boxGeometry args={[width, 0.1, depth]} />
        <meshStandardMaterial color="#0b1423" />
      </mesh>
      <Text
        position={[0, height / 2 + 0.3, depth / 2 - 0.3]}
        fontSize={0.28}
        color="#cbd5e1"
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
      {children}
    </group>
  );
}
