import { format } from "date-fns";
import { HorizontalBarChart } from "../../charts/HorizontalBarChart";
import {
  EOD_STATE_LABELS,
  MORNING_STATE_LABELS,
  REGULATION_STATE_ORDER,
  mergeHeadsUpNotes,
  summarizeByDay,
  tallyFlags,
} from "@/lib/fba/dailyPatterns";
import type { MorningCheckinEntry, TeacherUpdateEntry } from "@/hooks/useDailyPatterns";

// Read-only evidence panel -- not tagged, not scored, contributes
// nothing to Section 8's completeness (a deliberate choice: this is
// context for the clinician's own narrative interpretation, not itself
// a thing to "complete"). Uses the same assessment date range already
// driving the ABC pull just above it.
export function DailyPatternsPanel({
  checkins,
  updates,
  rangeStart,
  rangeEnd,
}: {
  checkins: MorningCheckinEntry[];
  updates: TeacherUpdateEntry[];
  rangeStart: string;
  rangeEnd: string;
}) {
  const morningCounts = summarizeByDay(checkins, rangeStart, rangeEnd);
  const eodCounts = summarizeByDay(updates, rangeStart, rangeEnd);
  const totalDays =
    morningCounts.settled + morningCounts.unsettled + morningCounts.dysregulated + morningCounts.noData;
  const flagCounts = tallyFlags(updates, rangeStart, rangeEnd);
  const notes = mergeHeadsUpNotes(checkins, updates, rangeStart, rangeEnd);

  const dayLabel = (value: number) => `${value} day${value === 1 ? "" : "s"}`;

  const morningBars = [
    ...REGULATION_STATE_ORDER.map((state) => ({
      label: MORNING_STATE_LABELS[state],
      value: morningCounts[state],
      max: totalDays || 1,
    })),
    { label: "No check-in", value: morningCounts.noData, max: totalDays || 1 },
  ];

  const eodBars = [
    ...REGULATION_STATE_ORDER.map((state) => ({
      label: EOD_STATE_LABELS[state],
      value: eodCounts[state],
      max: totalDays || 1,
    })),
    { label: "No update", value: eodCounts.noData, max: totalDays || 1 },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-bold text-brand-neutral-black">Morning Check-Ins</p>
        <HorizontalBarChart bars={morningBars} valueLabel={(bar) => dayLabel(bar.value)} />
      </div>

      <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-bold text-brand-neutral-black">End-of-Day Updates</p>
        <HorizontalBarChart bars={eodBars} valueLabel={(bar) => dayLabel(bar.value)} />
        {flagCounts.length > 0 && (
          <div className="mt-4 border-t border-black/5 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/40">
              Most Frequent Flags
            </p>
            <div className="flex flex-wrap gap-1.5">
              {flagCounts.map((flag) => (
                <span
                  key={flag.label}
                  className="rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 text-xs font-semibold text-brand-prussian-blue"
                >
                  {flag.label} ({flag.count})
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <p className="mb-3 text-sm font-bold text-brand-neutral-black">Heads-Up Notes</p>
        {notes.length === 0 ? (
          <p className="text-sm text-brand-neutral-black/50">No heads-up notes in this range.</p>
        ) : (
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
            {notes.map((note) => (
              <div key={note.id} className="border-b border-black/5 pb-3 last:border-0 last:pb-0">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-brand-prussian-blue">{note.role}</span>
                  <span className="flex-shrink-0 text-xs text-brand-neutral-black/40">
                    {format(new Date(`${note.date}T00:00:00`), "d MMM yyyy")}
                  </span>
                </div>
                <p className="text-sm text-brand-neutral-black/80">{note.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
