import type { MessageRecipientCandidate } from "@/types/messages";

// Strategy update default recipients (3B): the child's parent + every
// actively-linked teacher. Never clinicians (a strategy update is
// clinician-authored, addressed to the people who need to act on it
// day-to-day) -- still adjustable afterward via the compose sheet's
// normal recipient picker, this is only the sensible starting
// selection.
export function buildStrategyUpdateRecipientIds(candidates: MessageRecipientCandidate[]): string[] {
  return candidates
    .filter((candidate) => candidate.role === "parent" || candidate.role === "class_teacher")
    .map((candidate) => candidate.recipientId);
}
