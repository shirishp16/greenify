import type { ReactNode } from "react";
import { motion } from "framer-motion";

interface SectionCardProps {
  title: string;
  children: ReactNode;
  eyebrow?: string;
}

export function SectionCard({ title, children, eyebrow }: SectionCardProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="panel p-5"
    >
      {eyebrow ? <div className="mb-2 text-xs uppercase tracking-[0.28em] text-accent">{eyebrow}</div> : null}
      <h2 className="mb-4 text-lg font-semibold text-white">{title}</h2>
      {children}
    </motion.section>
  );
}
