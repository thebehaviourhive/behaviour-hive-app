"use client";

import Link from "next/link";

// PRD 4, Stage 2 -- the one work-queue row, shared by both dashboards
// (principal's seven/eight buckets now, the teacher's six immediately
// after in this same stage). Two definitions of a work-queue row is
// exactly the drift this project has avoided everywhere else, so this
// is built once and reused, not forked per track.
//
// The four columns map directly onto Stage 1's type-scale tokens --
// the first real content to use them: Entity is h2 (Baloo 2,
// Semi-bold), Exception is body (Nunito Sans), Context is eyebrow
// (Quicksand, bold, uppercase), Action is body-weight-semibold (the
// PRD's own Button role, which reuses the body token -- same family
// and size as Body, only the weight differs, and weight is already an
// applied utility under this scheme, not a separate token).
//
// Context is OPTIONAL and, when absent, genuinely absent -- not an
// empty cell. Four of the fourteen real buckets across both dashboards
// have nothing meaningful to put there (checked against each bucket's
// live RPC before building this, not assumed): join requests and
// unassigned children have no timestamp at all; no-SNA-assigned is a
// standing gap with no "since" to compute; cover-expiring-today gets a
// deadline (formatTimeOfDay upstream), not an elapsed wait, when the
// caller has one. The layout accounts for this structurally --
// Exception's own flex-1 fills the space Context would have taken,
// nothing renders in its place -- rather than every row reserving a
// slot that most rows leave blank.
//
// urgent controls the row's own background (a subtle Pastel Blue tint
// vs plain white) -- the PRD's per-row treatment for the "NEEDS ACTION
// NOW" group. The GROUP heading itself (Golden Brown vs Prussian Blue
// eyebrow, "NEEDS ACTION NOW" / "ROUTINE") is each dashboard page's own
// concern, not this component's -- a leaf row doesn't know which
// section it's rendered inside, and grouping differs enough between
// the two dashboards' own bucket sets that baking it in here would
// mean forking the grouping logic right back into two copies, the
// exact thing this component exists to avoid.
export interface WorkQueueRowProps {
  entity: string;
  exception: string;
  // Omit entirely for a bucket with nothing meaningful to show here --
  // see the header comment. Never pass an empty string as a stand-in.
  context?: string;
  actionLabel: string;
  // Exactly one of onAction/href -- a real mutation (Approve, Mark
  // called, Countersign) uses onAction; a row whose only "action" is
  // opening the record it's about (Review) uses href. Callers choose,
  // this component doesn't guess.
  onAction?: () => void;
  href?: string;
  isActionPending?: boolean;
  urgent?: boolean;
}

export function WorkQueueRow({
  entity,
  exception,
  context,
  actionLabel,
  onAction,
  href,
  isActionPending = false,
  urgent = false,
}: WorkQueueRowProps) {
  const rowClassName = `rounded-2xl border p-4 shadow-sm lg:flex lg:items-center lg:gap-4 ${
    urgent ? "border-brand-golden-brown/20 bg-brand-pastel-blue/15" : "border-black/5 bg-white"
  }`;

  const actionButtonClassName =
    "mt-3 flex-shrink-0 rounded-xl bg-brand-prussian-blue px-4 py-2 text-center font-sans text-body font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 lg:mt-0";

  const action = href ? (
    <Link href={href} className={`block ${actionButtonClassName}`}>
      {actionLabel}
    </Link>
  ) : (
    <button
      type="button"
      onClick={onAction}
      disabled={isActionPending}
      className={`w-full ${actionButtonClassName}`}
    >
      {isActionPending ? "…" : actionLabel}
    </button>
  );

  return (
    <div className={rowClassName}>
      {/* Entity column -- fixed width at lg+ so every row's Exception
          column lines up regardless of name length; truncates rather
          than wrapping and breaking the row's height. */}
      <div className="flex items-baseline justify-between gap-2 lg:block lg:w-48 lg:flex-shrink-0">
        <p className="truncate font-heading text-h2 font-semibold text-brand-prussian-blue">{entity}</p>
        {context && (
          <p className="flex-shrink-0 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50 lg:hidden">
            {context}
          </p>
        )}
      </div>

      {/* Exception column -- the one flexible column, so Context's
          absence is reclaimed space, not a gap. */}
      <p className="mt-1 font-sans text-body text-brand-neutral-black/80 lg:mt-0 lg:min-w-0 lg:flex-1">
        {exception}
      </p>

      {/* Context column -- desktop only here; the mobile copy sits
          beside Entity above instead, matching the PRD's "name and
          timestamp on the top line" stacked spec. */}
      {context && (
        <p className="hidden font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50 lg:block lg:w-40 lg:flex-shrink-0 lg:text-right">
          {context}
        </p>
      )}

      {action}
    </div>
  );
}
