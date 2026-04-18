import { useMemo } from "react";
import { formatCurrency, type MonthlySavingsPoint } from "../savings";

interface SavingsTrendChartProps {
  points: MonthlySavingsPoint[];
  view: "cost" | "energy";
}

interface ChartPoint {
  x: number;
  y: number;
  value: number;
  label: string;
}

function formatTick(value: number, view: "cost" | "energy"): string {
  if (view === "cost") {
    return formatCurrency(value);
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} kWh`;
}

export function SavingsTrendChart({ points, view }: SavingsTrendChartProps) {
  const width = 760;
  const height = 290;
  const padding = { top: 22, right: 24, bottom: 40, left: 64 };

  const {
    chartPoints,
    linePath,
    areaPath,
    maxValue,
    horizontalTicks,
    xLabelPoints,
  }: {
    chartPoints: ChartPoint[];
    linePath: string;
    areaPath: string;
    maxValue: number;
    horizontalTicks: number[];
    xLabelPoints: ChartPoint[];
  } = useMemo(() => {
    const values = points.map((point) => (view === "cost" ? point.costUsd : point.energyKwh));
    const derivedMax = Math.max(1, ...values);

    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const step = plotWidth / Math.max(points.length - 1, 1);

    const toY = (value: number) => {
      const ratio = value / derivedMax;
      return padding.top + plotHeight - ratio * plotHeight;
    };

    const nextChartPoints: ChartPoint[] = points.map((point, index) => ({
      x: padding.left + step * index,
      y: toY(view === "cost" ? point.costUsd : point.energyKwh),
      value: view === "cost" ? point.costUsd : point.energyKwh,
      label: point.label,
    }));

    const nextLinePath = nextChartPoints
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" ");

    const baseY = height - padding.bottom;
    const nextAreaPath =
      nextChartPoints.length > 1
        ? `${nextLinePath} L ${nextChartPoints[nextChartPoints.length - 1].x} ${baseY} L ${nextChartPoints[0].x} ${baseY} Z`
        : "";

    const nextHorizontalTicks = Array.from({ length: 5 }, (_, index) => (derivedMax * index) / 4);

    const desiredLabels = 6;
    const gap = Math.max(1, Math.floor(points.length / desiredLabels));
    const nextXLabelPoints = nextChartPoints.filter((_, index) => index % gap === 0 || index === points.length - 1);

    return {
      chartPoints: nextChartPoints,
      linePath: nextLinePath,
      areaPath: nextAreaPath,
      maxValue: derivedMax,
      horizontalTicks: nextHorizontalTicks,
      xLabelPoints: nextXLabelPoints,
    };
  }, [points, view]);

  if (points.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-2xl border border-stone-900/10 bg-stone-900/5 text-sm text-stone-500">
        No savings points yet.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-stone-900/10 bg-stone-50/85 p-4">
      <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-stone-500">
        <span>{view === "cost" ? "Daily Cost Savings" : "Daily Energy Savings"}</span>
        <span>
          Peak {view === "cost" ? formatCurrency(maxValue) : `${maxValue.toFixed(2)} kWh`}
        </span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="h-64 w-full" role="img" aria-label="Monthly savings trend">
        {horizontalTicks.map((tickValue) => {
          const plotHeight = height - padding.top - padding.bottom;
          const y = padding.top + plotHeight - (tickValue / maxValue) * plotHeight;
          return (
            <g key={`grid-${tickValue}`}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="rgba(41, 37, 36, 0.12)" strokeDasharray="3 5" />
              <text x={padding.left - 10} y={y + 4} textAnchor="end" className="fill-stone-500" fontSize="10">
                {formatTick(tickValue, view)}
              </text>
            </g>
          );
        })}

        {areaPath ? <path d={areaPath} fill="rgba(74, 124, 89, 0.18)" /> : null}
        <path d={linePath} fill="none" stroke="#3b7d4f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

        {chartPoints.map((point, index) => (
          <circle
            key={`${point.label}-${index}`}
            cx={point.x}
            cy={point.y}
            r={index === chartPoints.length - 1 ? 4.2 : 2.8}
            fill={index === chartPoints.length - 1 ? "#1f7a3f" : "#4a7c59"}
            opacity={index === chartPoints.length - 1 ? 1 : 0.75}
          />
        ))}

        {xLabelPoints.map((point, index) => (
          <text key={`label-${point.label}-${index}`} x={point.x} y={height - 14} textAnchor="middle" className="fill-stone-500" fontSize="10">
            {point.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
