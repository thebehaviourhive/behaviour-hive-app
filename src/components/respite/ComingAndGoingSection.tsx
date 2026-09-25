import Link from "next/link";
import type { ScheduleEntry } from "@/hooks/useCentreDashboardOverview";

// Respite UI Stage 2a, block 2 -- arrivals and departures over the
// next seven days. Did not exist anywhere before this; the only way to
// find out when a child was next in was to open their record one at a
// time. At thirty children this is the centre's own schedule and the
// block a manager plans cover around -- capped the same way Today is,
// so a genuinely busy week doesn't become a wall either.
const SHOWN_ROW_LIMIT = 8;

function formatDateWeekday(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function ComingAndGoingSection({ schedule, isLoading }: { schedule: ScheduleEntry[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <section>
        <div className="h-6 w-40 animate-pulse rounded bg-black/10" />
        <div className="mt-2 h-16 animate-pulse rounded-2xl bg-white" />
      </section>
    );
  }

  const shown = schedule.slice(0, SHOWN_ROW_LIMIT);
  const remaining = schedule.length - shown.length;

  return (
    <section>
      <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
        Coming and Going
      </h2>
      {schedule.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
          No arrivals or departures in the next 7 days.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((entry, i) => (
            <Link
              key={`${entry.passportId}-${entry.kind}-${i}`}
              href={`/centre/passport/${entry.passportId}`}
              className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
            >
              <p className="font-semibold text-brand-neutral-black">{entry.childName}</p>
              <p className="text-sm text-black/60">
                {entry.kind === "arrival" ? "Arrives" : "Departs"} {formatDateWeekday(entry.date)}
              </p>
            </Link>
          ))}
          {remaining > 0 && (
            <p className="rounded-2xl bg-black/5 px-4 py-2 text-center text-sm text-black/50">
              +{remaining} more this week
            </p>
          )}
        </div>
      )}
    </section>
  );
}
