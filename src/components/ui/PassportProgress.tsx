interface PassportProgressProps {
  sectionLabel: string;
  stepLabel?: string;
  percent: number;
}

// PRD 3, Stage 4 -- visibility label, not a policy notice. One line, in
// the header every Section A-D page already shares, above every field --
// the point is a parent knows while typing, not that we've disclosed
// something. Sections A-D are school-wide by design (has_child_access(),
// unchanged since Stage 1); this is the one component that needs the
// label, since every wizard step mounts it.
export function PassportProgress({
  sectionLabel,
  stepLabel,
  percent,
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
        Everyone working with your child at school can read this.
      </p>
    </div>
  );
}
