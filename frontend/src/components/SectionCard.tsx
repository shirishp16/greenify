import type { ReactNode } from "react";
import { motion } from "framer-motion";

interface SectionCardProps {
  title: string;
  children: ReactNode;
  eyebrow?: string;
  className?: string;
}

export function SectionCard({ title, children, eyebrow, className = "" }: SectionCardProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className={`panel p-5 ${className}`}
    >
      {eyebrow ? (
        <div className="mb-2">
          <div className="text-xs uppercase tracking-[0.28em] text-accent">{eyebrow}</div>
          <div className="mt-1.5 h-px bg-accent/20" />
        </div>
      ) : null}
      <h2 className="mb-4 text-lg font-semibold text-stone-900">{title}</h2>
      {children}
    </motion.section>
  );
}
