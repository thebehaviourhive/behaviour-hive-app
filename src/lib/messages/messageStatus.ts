import type { ThreadMessage } from "@/types/messages";

// The single shared definition of "open" vs "archived" -- every surface
// that renders an Open/Archived toggle (parent's MessageList, the
// teacher/clinician MessageTriage) imports this instead of re-deriving
// it locally. Two independently-maintained copies of this exact
// three-line function is how a status-filtering bug would eventually
// happen -- one gets tweaked, the other doesn't, and the tracks silently
// diverge. One function, every surface reads it the same way.
export function isOpenStatus(status: ThreadMessage["status"]): boolean {
  return status === "open" || status === "in_discussion";
}
