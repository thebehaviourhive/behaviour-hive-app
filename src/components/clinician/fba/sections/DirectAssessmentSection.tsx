import { NarrativeField } from "../NarrativeField";
import { FbaNote } from "../FbaNote";
import type { FbaSectionBodyProps } from "./types";

export function DirectAssessmentSection({
  content,
  onFieldChange,
  onFieldBlur,
  readOnly,
}: FbaSectionBodyProps) {
  return (
    <div className="flex flex-col gap-6">
      <NarrativeField
        label="On-Site Observations"
        value={content.onSiteObservations ?? ""}
        onChange={(next) => onFieldChange({ ...content, onSiteObservations: next })}
        onBlur={onFieldBlur}
        readOnly={readOnly}
        rows={8}
      />
      <NarrativeField
        label="Community Participation & Leisure"
        value={content.communityParticipation ?? ""}
        onChange={(next) => onFieldChange({ ...content, communityParticipation: next })}
        onBlur={onFieldBlur}
        readOnly={readOnly}
        rows={8}
      />
      <div>
        <p className="mb-2 font-heading text-base font-bold text-brand-neutral-black">
          ABC Data Analysis
        </p>
        <FbaNote>ABC data integration coming in the next update.</FbaNote>
      </div>
    </div>
  );
}
