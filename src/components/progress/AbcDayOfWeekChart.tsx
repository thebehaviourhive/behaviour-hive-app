import { HorizontalBarChart } from "@/components/clinician/fba/charts/HorizontalBarChart";
import type { WeekdayIncidentEntry } from "@/lib/progress/abc";

// Factual for every role -- incident-count day-of-week pattern doesn't
// get the parent warmth treatment the regulation day-of-week chart does
// (that one narrates a "best"/"toughest" day; this one is a plain count,
// left for the reader to interpret rather than editorialised).
export function AbcDayOfWeekChart({ pattern }: { pattern: WeekdayIncidentEntry[] }) {
  const max = Math.max(1, ...pattern.map((p) => p.count));
  const bars = pattern.map((p) => ({ label: p.weekday, value: p.count, max }));
  return <HorizontalBarChart bars={bars} valueLabel={(bar) => `${bar.value}`} />;
}
