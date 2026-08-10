import { Checkbox } from "@/components/ui/Checkbox";
import { TextField } from "@/components/ui/TextField";
import type { FbaSectionBodyProps } from "./types";

const METHODS = [
  "File review of documents",
  "Review of school and home incidents",
  "Open-Ended Functional Assessment Interview",
  "QABF & MAS",
  "AFLS",
  "ABC Data Monitoring",
  "Home and School In-Person Observations",
  "Online meetings with primary caregivers",
];

export function AssessmentMethodsSection({
  content,
  onFieldChange,
  onFieldBlur,
  onStructuralChange,
  readOnly,
}: FbaSectionBodyProps) {
  const selected = content.assessmentMethods ?? [];

  function toggle(method: string) {
    const next = selected.includes(method)
      ? selected.filter((m) => m !== method)
      : [...selected, method];
    onStructuralChange({ ...content, assessmentMethods: next });
  }

  if (readOnly) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
          {METHODS.map((method) => (
            <div key={method} className="flex items-center gap-2 text-sm">
              <span
                className={`h-2 w-2 flex-shrink-0 rounded-full ${
                  selected.includes(method) ? "bg-brand-prussian-blue" : "bg-black/10"
                }`}
              />
              <span
                className={
                  selected.includes(method) ? "text-brand-neutral-black" : "text-black/40"
                }
              >
                {method}
              </span>
            </div>
          ))}
        </div>
        {content.assessmentMethodsOther?.trim() && (
          <div>
            <p className="mb-1 text-sm font-semibold text-brand-neutral-black">Other</p>
            <p className="text-sm text-brand-neutral-black">{content.assessmentMethodsOther}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        {METHODS.map((method) => (
          <Checkbox
            key={method}
            id={`method-${method}`}
            checked={selected.includes(method)}
            onChange={() => toggle(method)}
            label={method}
          />
        ))}
      </div>
      <TextField
        label="Other"
        value={content.assessmentMethodsOther ?? ""}
        onChange={(e) => onFieldChange({ ...content, assessmentMethodsOther: e.target.value })}
        onBlur={onFieldBlur}
        placeholder="Any additional method used"
      />
    </div>
  );
}
