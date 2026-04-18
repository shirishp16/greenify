export function formatWatts(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} kW`;
  }
  return `${Math.round(value)} W`;
}

export function formatClock(value: string | null): string {
  if (!value) {
    return "None";
  }

  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function toTitleCase(value: string): string {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
