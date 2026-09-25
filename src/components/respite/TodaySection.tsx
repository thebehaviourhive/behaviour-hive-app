import Link from "next/link";
import type { OnSiteChild } from "@/hooks/useCentreDashboardOverview";

// Respite UI Stage 2a, block 1 -- the biggest thing on the page. Scoped
// to children genuinely ON-SITE right now (an open respite_activations
// row), never the full placed-here roster -- "who is at the centre
// right now," not "who exists." At two, every row is shown by name. At
// thirty, only the rows that need something are named in full; the
// rest collapse to one summary line, one tap from the full roster --
// per the brief's own "a count with the ones needing attention
// surfaced and the rest one tap away."
//
// The threshold below is a starting number, not a measured one -- the
// same conservative-and-named posture this codebase already uses for
// its other tunable thresholds (SnoozableWorkQueueRow's own repeat-
// count line). Revisit once a real thirty-child day shows what "too
// many named rows" actually feels like.
const NAMED_ROW_LIMIT = 8;

function CheckinChip({ label, done }: { label: string; done: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
        done ? "bg-brand-prussian-blue/10 text-brand-prussian-blue" : "bg-black/5 text-black/40"
      }`}
    >
      {label} {done ? "done" : "outstanding"}
    </span>
  );
}

function ChildRow({ child }: { child: OnSiteChild }) {
  return (
    <Link
      href={`/centre/passport/${child.passportId}`}
      className="flex flex-col gap-1.5 rounded-2xl border border-black/5 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="font-semibold text-brand-neutral-black">{child.childName}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <CheckinChip label="Morning" done={child.hasMorning} />
        <CheckinChip label="End of day" done={child.hasEndOfDay} />
        {child.hasLoggedToday && (
          <span className="rounded-full bg-brand-golden-brown/15 px-2 py-0.5 text-xs font-semibold text-brand-golden-brown">
            Logged today
          </span>
        )}
      </div>
    </Link>
  );
}

export function TodaySection({
  onSiteChildren,
  isLoading,
}: {
  onSiteChildren: OnSiteChild[];
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <section>
        <div className="h-6 w-24 animate-pulse rounded bg-black/10" />
        <div className="mt-2 flex flex-col gap-2">
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
        </div>
      </section>
    );
  }

  const needsAttention = onSiteChildren.filter((c) => !c.hasMorning && !c.hasEndOfDay);
  const checkedIn = onSiteChildren.filter((c) => c.hasMorning || c.hasEndOfDay);
  const showEveryoneByName = onSiteChildren.length <= NAMED_ROW_LIMIT;

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
          Today
        </h2>
        <p className="font-sans text-eyebrow text-brand-neutral-black/50">
          {onSiteChildren.length} on-site
        </p>
      </div>

      {onSiteChildren.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
          No children on-site today.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {needsAttention.map((child) => (
            <ChildRow key={child.passportId} child={child} />
          ))}
          {showEveryoneByName
            ? checkedIn.map((child) => <ChildRow key={child.passportId} child={child} />)
            : checkedIn.length > 0 && (
                <Link
                  href="/centre/children"
                  className="rounded-2xl border border-black/5 bg-white p-4 text-center text-sm font-semibold text-brand-prussian-blue shadow-sm"
                >
                  +{checkedIn.length} more, checked in -- View all
                </Link>
              )}
        </div>
      )}
    </section>
  );
}
