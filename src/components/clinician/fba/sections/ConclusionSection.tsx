import { TextField } from "@/components/ui/TextField";
import { NarrativeField } from "../NarrativeField";
import type { FbaSectionBodyProps } from "./types";

function SignOffRow({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-brand-neutral-black/50">{label}</p>
      <p className="text-base text-brand-neutral-black">{value?.trim() ? value : "—"}</p>
    </div>
  );
}

export function ConclusionSection({
  content,
  onFieldChange,
  onFieldBlur,
  readOnly,
}: FbaSectionBodyProps) {
  return (
    <div className="flex flex-col gap-6">
      <NarrativeField
        value={content.conclusion ?? ""}
        onChange={(next) => onFieldChange({ ...content, conclusion: next })}
        onBlur={onFieldBlur}
        readOnly={readOnly}
        rows={12}
        placeholder="Conclusion…"
      />

      <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <p className="mb-3 font-heading text-base font-bold text-brand-neutral-black">Sign-off</p>
        <div className="flex flex-col gap-3">
          {readOnly ? (
            <>
              <SignOffRow label="Name" value={content.signOffName} />
              <SignOffRow label="Credentials" value={content.signOffCredentials} />
              <SignOffRow label="Date" value={content.signOffDate} />
            </>
          ) : (
            <>
              <TextField
                label="Name"
                value={content.signOffName ?? ""}
                onChange={(e) => onFieldChange({ ...content, signOffName: e.target.value })}
                onBlur={onFieldBlur}
              />
              <TextField
                label="Credentials"
                value={content.signOffCredentials ?? ""}
                onChange={(e) => onFieldChange({ ...content, signOffCredentials: e.target.value })}
                onBlur={onFieldBlur}
              />
              <TextField
                label="Date"
                type="date"
                value={content.signOffDate ?? ""}
                onChange={(e) => onFieldChange({ ...content, signOffDate: e.target.value })}
                onBlur={onFieldBlur}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
