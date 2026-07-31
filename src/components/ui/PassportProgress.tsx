interface PassportProgressProps {
  sectionLabel: string;
  stepLabel?: string;
  percent: number;
}

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
          {stepLabel ? ` — ${stepLabel}` : ""}
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
    </div>
  );
}
