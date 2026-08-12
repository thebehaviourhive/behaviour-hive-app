import { toLocalDateString } from "./dateUtils";
import type { DateRange } from "./range";

// Minimal shape this module needs from ClinicalContentItem (passportClinicalContent.ts)
// -- structural, not imported, same reasoning as flags.ts.
export interface StrategyPublicationSource {
  createdAt: string;
}

// Distinct local-calendar publication dates within the given range --
// "multiple dates = multiple markers" per the brief. A single
// approve_fba_strategies() call can insert several passport_clinical_content
// rows with the same timestamp (one per strategy/trigger/setting-event
// item), so this collapses to one marker per DAY, not one per row.
// Role-scoping is already handled upstream by get_passport_clinical_content
// (teacher only ever receives strategy_school/strategy_shared/trigger/
// setting_event rows) -- this function has no role awareness of its own,
// it just turns "whatever rows this caller was allowed to fetch" into
// marker dates.
export function strategyMarkerDates(items: StrategyPublicationSource[], range: DateRange): string[] {
  const dates = new Set<string>();
  for (const item of items) {
    const date = toLocalDateString(new Date(item.createdAt));
    if (date >= range.start && date <= range.end) dates.add(date);
  }
  return Array.from(dates).sort();
}
