import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import {
  formatCurrency,
  formatKwh,
  type MonthlySavingsPoint,
  type SavingsBreakdownEntry,
  type SavingsTotals,
} from "../savings";
import { SavingsTrendChart } from "./SavingsTrendChart";

interface MonthlySavingsModalProps {
  open: boolean;
  view: "cost" | "energy";
  onClose: () => void;
  onViewChange: (view: "cost" | "energy") => void;
  points: MonthlySavingsPoint[];
  totals: SavingsTotals;
  breakdown: SavingsBreakdownEntry[];
  thisMonthRuns: number;
  averageRatePerKwh: number;
  isUsingSeededData: boolean;
}

export function MonthlySavingsModal({
  open,
  view,
  onClose,
  onViewChange,
  points,
  totals,
  breakdown,
  thisMonthRuns,
  averageRatePerKwh,
  isUsingSeededData,
}: MonthlySavingsModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/35 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.section
            className="panel max-h-[90vh] w-full max-w-5xl overflow-y-auto p-5 sm:p-6"
            initial={{ opacity: 0, y: 22, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 250, damping: 24 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-accent">
                  Monthly Savings
                </div>
                <h3 className="text-2xl font-semibold tracking-tight text-stone-900">Energy and cost impact over the last 30 days</h3>
                <p className="mt-2 text-sm text-stone-600">
                  Includes {isUsingSeededData ? "seeded demo history" : "completed run history"} and converts energy to cost using an average rate of {formatCurrency(averageRatePerKwh)}/kWh.
                </p>
              </div>

              <button
                type="button"
                className="rounded-xl border border-stone-900/15 bg-stone-100 px-3 py-1.5 text-sm text-stone-700 transition hover:bg-stone-200"
                onClick={onClose}
              >
                Close
              </button>
            </div>

            <div className="mb-5 grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-success/25 bg-success/10 p-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-success">Monthly Value</div>
                <div className="mt-2 text-2xl font-semibold text-stone-900">{formatCurrency(totals.costUsd)}</div>
              </div>
              <div className="rounded-2xl border border-stone-900/10 bg-stone-900/5 p-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Monthly Energy</div>
                <div className="mt-2 text-2xl font-semibold text-stone-900">{formatKwh(totals.energyKwh)}</div>
              </div>
              <div className="rounded-2xl border border-stone-900/10 bg-stone-900/5 p-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Estimated CO2 Avoided</div>
                <div className="mt-2 text-2xl font-semibold text-stone-900">{totals.co2KgAvoided.toFixed(1)} kg</div>
              </div>
              <div className="rounded-2xl border border-stone-900/10 bg-stone-900/5 p-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Runs This Month</div>
                <div className="mt-2 text-2xl font-semibold text-stone-900">{thisMonthRuns}</div>
              </div>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                  view === "cost" ? "bg-accent text-white" : "bg-stone-900/6 text-stone-600 hover:bg-stone-900/10"
                }`}
                onClick={() => onViewChange("cost")}
              >
                Cost View
              </button>
              <button
                type="button"
                className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                  view === "energy" ? "bg-accent text-white" : "bg-stone-900/6 text-stone-600 hover:bg-stone-900/10"
                }`}
                onClick={() => onViewChange("energy")}
              >
                Energy View
              </button>
            </div>

            <SavingsTrendChart points={points} view={view} />

            <div className="mt-5 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-2xl border border-stone-900/10 bg-stone-50/85 p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">What drives monthly savings</div>
                {breakdown.length > 0 ? (
                  <div className="space-y-2.5">
                    {breakdown.map((entry) => (
                      <div key={entry.category} className="flex items-center justify-between rounded-xl bg-stone-900/5 px-3 py-2 text-sm">
                        <span className="text-stone-700">{entry.category}</span>
                        <span className="font-medium text-stone-900">
                          {formatCurrency(entry.costUsd)} • {formatKwh(entry.energyKwh)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl bg-stone-900/5 px-3 py-2 text-sm text-stone-500">Run the optimizer to populate a category breakdown.</div>
                )}
              </div>

              <div className="rounded-2xl border border-stone-900/10 bg-stone-50/85 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Estimation Notes</div>
                <ul className="space-y-2 text-sm leading-6 text-stone-600">
                  <li>Each run converts power reduction to energy saved using inferred session duration.</li>
                  <li>Energy is converted to cost using a default rate of {formatCurrency(0.16)}/kWh and peak-adjusted scenarios when applicable.</li>
                  <li>Monthly trend rolls up daily history. If no history exists yet, a clearly seeded baseline is shown for demo continuity.</li>
                </ul>
              </div>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
