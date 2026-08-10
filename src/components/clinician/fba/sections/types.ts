import type { FbaContentData } from "@/lib/fba/types";

// Shared prop contract for every section body that edits content_data
// directly. `onFieldChange` is a local-only update (bound to a text
// input's onChange); `onFieldBlur` fires the actual auto-save of
// whatever is currently in content_data; `onStructuralChange` both
// updates and immediately saves, for edits with no natural blur moment
// (checkbox toggles, add/delete/reorder).
export interface FbaSectionBodyProps {
  content: FbaContentData;
  onFieldChange: (next: FbaContentData) => void;
  onFieldBlur: () => void;
  onStructuralChange: (next: FbaContentData) => void;
  readOnly: boolean;
}
