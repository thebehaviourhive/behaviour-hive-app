interface PassportProgressProps {
  sectionLabel: string;
  stepLabel?: string;
  percent: number;
  // Finding 1, 22 Sept 2026 -- "at school" was unconditional, false
  // for a clinic-only family. Defaults true, matching every call
  // site's own real-account majority and never worse than what shipped
  // before this fix (Tier 1 item 4's own posture, reused) -- a caller
  // that hasn't been threaded up to a real hasSchoolLink signal yet
  // keeps the exact behaviour it already had.
  hasSchoolLink?: boolean;
}

// PRD 3, Stage 4 -- visibility label, not a policy notice. One line, in
// the header every Section A-D page already shares, above every field --
// the point is a parent knows while typing, not that we've disclosed
// something. Sections A-D are school-wide by design (has_child_access(),
// unchanged since Stage 1) for a school-linked child -- but the same
// wizard is also how a clinic-only family builds their passport
// (onboard_clinic_client() creates one with no school link at all,
// ever), for whom "at school" was simply false, not just imprecise.
export function PassportProgress({
  sectionLabel,
  stepLabel,
  percent,
  hasSchoolLink = true,
}: PassportProgressProps) {
  return (
    <div className="mb-5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-black/50">
          {sectionLabel}
          {stepLabel ? ` · ${stepLabel}` : ""}
        </span>
        <span className="text-xs font-semibold text-brand-prussian-blue">
          {percent}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10">
        <div
          className="h-full rounded-full bg-brand-prussian-blue"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-black/40">
        {hasSchoolLink
          ? "Everyone working with your child at school can read this."
          : "Everyone on your child's clinical team can read this."}
      </p>
    </div>
  );
}
