// The incident PDF's own convention (teacher/incidents/[incidentId]/print),
// reused verbatim: "not recorded" distinguishes a field nothing was ever
// entered for from a field whose real value happens to be empty/false --
// words, never colour, matching this whole export's own print heritage.
export function ExportField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">{label}</p>
      <p className="whitespace-pre-wrap text-sm text-brand-neutral-black">{value && value.trim() !== "" ? value : "not recorded"}</p>
    </div>
  );
}

export function ExportSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="print-avoid-break mb-6 rounded-2xl border border-black/10 p-4 print:rounded-none">
      <div className="mb-3 border-b border-black/10 pb-2">
        <p className="font-heading text-base font-bold text-brand-prussian-blue">{title}</p>
        {subtitle && <p className="text-xs text-brand-neutral-black/60">{subtitle}</p>}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}
