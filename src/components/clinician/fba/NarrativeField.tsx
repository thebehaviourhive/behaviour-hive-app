// Single long-form textarea bound to one content_data field, auto-saving
// on blur. Reused by every plain-narrative section (2, 4, 9, 10) and as a
// sub-field inside a few structured sections (6, 8, 11's summary, 13).
export function NarrativeField({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  readOnly,
  rows = 10,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  placeholder?: string;
  readOnly: boolean;
  rows?: number;
}) {
  if (readOnly) {
    return (
      <div>
        {label && <p className="mb-1.5 text-sm font-semibold text-brand-neutral-black">{label}</p>}
        <div className="whitespace-pre-wrap rounded-2xl border border-black/5 bg-white p-4 text-base text-brand-neutral-black">
          {value.trim() ? value : <span className="text-black/30">Not recorded.</span>}
        </div>
      </div>
    );
  }

  return (
    <div>
      {label && (
        <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">{label}</label>
      )}
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className="w-full resize-none rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
      />
    </div>
  );
}
