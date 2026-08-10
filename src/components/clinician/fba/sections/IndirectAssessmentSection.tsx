import { NarrativeField } from "../NarrativeField";
import { FbaNote } from "../FbaNote";
import type { FbaSectionBodyProps } from "./types";

export function IndirectAssessmentSection({
  content,
  onFieldChange,
  onFieldBlur,
  readOnly,
}: FbaSectionBodyProps) {
  return (
    <div className="flex flex-col gap-6">
      <NarrativeField
        label="Open-Ended Interview Notes"
        value={content.openEndedInterviewNotes ?? ""}
        onChange={(next) => onFieldChange({ ...content, openEndedInterviewNotes: next })}
        onBlur={onFieldBlur}
        readOnly={readOnly}
        rows={10}
      />
      <div>
        <p className="mb-2 font-heading text-base font-bold text-brand-neutral-black">QABF & MAS</p>
        <FbaNote>Results will appear when questionnaires are completed.</FbaNote>
      </div>
    </div>
  );
}
