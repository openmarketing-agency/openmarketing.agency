/** Describes a moment relative to now, such as "5 min ago" or "in 3 h", for live activity views. */

const units: [number, string][] = [[60, "s"], [60, "min"], [24, "h"], [7, "day"], [Infinity, "week"]];

export function relativeTime(date: Date, now = Date.now()) {
  let value = Math.round((date.getTime() - now) / 1000);
  const future = value > 0;
  value = Math.abs(value);
  if (value < 45) return future ? "in a moment" : "just now";
  let unit = "s";
  for (const [size, name] of units) {
    unit = name;
    if (value < size) break;
    value = Math.round(value / size);
  }
  const text = value + " " + unit + (value !== 1 && (unit === "day" || unit === "week") ? "s" : "");
  return future ? "in " + text : text + " ago";
}
