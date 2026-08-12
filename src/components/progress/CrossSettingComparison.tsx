import type { CrossSettingBucket } from "@/lib/progress/crossSetting";

// STAGE C, CLINICIAN LENS ONLY. Three aligned mini-bars per period bucket
// (home settled rate, school settled rate, incident count) -- same
// div-track-plus-fill idiom as the rest of Progress's charts, just three
// rows instead of one, so morning/afternoon/incidents read on one shared
// timeline without inventing a new axis-based chart type. Factual
// presentation only -- no "predicts" language, no trend line drawn
// between settings; the reader draws their own comparison from the
// numbers.
function MiniBar({ label, value, color, trackColor }: { label: string; value: number; color: string; trackColor?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 flex-shrink-0 text-[11px] font-medium text-brand-neutral-black/60">{label}</span>
      <div className={`h-2 flex-1 overflow-hidden rounded-full ${trackColor ?? "bg-black/10"}`}>
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

export function CrossSettingComparison({ buckets }: { buckets: CrossSettingBucket[] }) {
  const maxIncidents = Math.max(1, ...buckets.map((b) => b.incidentCount));

  if (buckets.every((b) => b.morningDataDays === 0 && b.afternoonDataDays === 0 && b.incidentCount === 0)) {
    return <p className="text-sm text-brand-neutral-black/50">No data in this period.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {buckets.map((b) => (
        <div key={b.start} className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-brand-neutral-black">{b.label}</p>
          <MiniBar
            label="Home"
            value={b.morningSettledRate ?? 0}
            color="bg-brand-prussian-blue"
          />
          <MiniBar
            label="School"
            value={b.afternoonSettledRate ?? 0}
            color="bg-[#3E7CB1]"
          />
          <MiniBar
            label="Incidents"
            value={(b.incidentCount / maxIncidents) * 100}
            color="bg-[#7A8B99]"
          />
          <p className="pl-16 text-[10px] text-brand-neutral-black/40">
            Home: {b.morningSettledRate === null ? "no data" : `${b.morningSettledRate}% settled (${b.morningDataDays}d)`}
            {" · "}
            School: {b.afternoonSettledRate === null ? "no data" : `${b.afternoonSettledRate}% settled (${b.afternoonDataDays}d)`}
            {" · "}
            Incidents: {b.incidentCount}
          </p>
        </div>
      ))}
      <p className="text-[11px] text-brand-neutral-black/40">
        Settled rates and incident counts shown side by side for the same periods -- not a claim that one causes the
        other.
      </p>
    </div>
  );
}
