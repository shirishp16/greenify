import type { ReactNode } from "react";
import { motion } from "framer-motion";

interface SectionCardProps {
  title: string;
  children: ReactNode;
  eyebrow?: string;
  subtitle?: string;
  className?: string;
}

export function SectionCard({ title, children, eyebrow, subtitle, className = "" }: SectionCardProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`panel p-5 sm:p-6 ${className}`}
    >
      {eyebrow ? (
        <div className="mb-2 inline-flex rounded-full border border-accent/20 bg-accent/8 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
          {eyebrow}
        </div>
      ) : null}

      <h2 className="text-xl font-semibold tracking-tight text-stone-900">{title}</h2>
      {subtitle ? <p className="mt-2 text-sm leading-6 text-stone-600">{subtitle}</p> : null}

      <div className="mt-4">{children}</div>
    </motion.section>
  );
}
