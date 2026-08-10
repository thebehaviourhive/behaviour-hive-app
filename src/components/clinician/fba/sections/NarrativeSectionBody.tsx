import { NarrativeField } from "../NarrativeField";
import type { FbaSectionDef } from "@/lib/fba/sections";
import type { FbaContentData } from "@/lib/fba/types";
import type { FbaSectionBodyProps } from "./types";

// Shared body for the four plain-narrative sections (2, 4, 9, 10) --
// they differ only in which content_data key they read/write, carried
// by the section definition's `narrativeField`.
export function NarrativeSectionBody({
  section,
  content,
  onFieldChange,
  onFieldBlur,
  readOnly,
}: FbaSectionBodyProps & { section: FbaSectionDef }) {
  const field = section.narrativeField;
  if (!field) return null;
  const value = (content[field] as string | undefined) ?? "";

  return (
    <NarrativeField
      value={value}
      onChange={(next) => onFieldChange({ ...content, [field]: next } as FbaContentData)}
      onBlur={onFieldBlur}
      placeholder="Start typing…"
      readOnly={readOnly}
      rows={14}
    />
  );
}
