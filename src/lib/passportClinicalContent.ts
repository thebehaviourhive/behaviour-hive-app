// Generic by design (Stage 1's own framing): passport_clinical_content
// isn't FBA-specific -- source_document_type is a free-text column so a
// future BSP or SLT/OT document can write here too. Nothing in this file
// or the components that render it branches on "FBA" specifically;
// SOURCE_DOCUMENT_LABELS is the one place a future source type gets a
// display label.

export type ClinicalItemType =
  | "trigger"
  | "setting_event"
  | "strategy_home"
  | "strategy_school"
  | "strategy_shared";

export interface ClinicalContentItem {
  id: string;
  itemType: ClinicalItemType;
  title: string;
  description: string;
  authorRole: string;
  authorName: string | null;
  // Nullable: a row could in principle lack a clinicians profile (see
  // get_passport_clinical_content's LEFT JOIN) -- degrades to
  // name-alone in that case rather than blocking on it.
  authorSpecialty: string | null;
  sourceDocumentType: string;
  createdAt: string;
}

export const SOURCE_DOCUMENT_LABELS: Record<string, string> = {
  fba_report: "FBA",
};
