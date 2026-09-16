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

// Stage 5, item 5: acknowledge_message() (0061) only flips the message's
// own shared status to 'acknowledged' once EVERY recipient has
// acknowledged -- correct for the message as a whole, but it meant an
// individual recipient who had already acknowledged still saw a
// non-response-required message sitting under "Open" until every OTHER
// recipient caught up too. Response-required messages are explicitly
// unaffected -- acknowledge_message() itself never touches their status
// at all (it's driven by reply/close), so isOpenStatus(message.status)
// alone remains the correct, unchanged answer for them.
//
// For a non-response-required message, this archives it FOR THIS VIEWER
// the instant their own message_recipients row shows acknowledged_at --
// independent of whether any other recipient has, and independent of
// the shared status. The sender (who has no message_recipients row of
// their own) falls through to the unchanged shared-status behaviour --
// their own "Open" list still means "not every recipient has
// acknowledged yet", exactly as before.
export function isOpenForViewer(message: ThreadMessage, viewerId: string): boolean {
  if (!message.responseRequired) {
    const ownRecipient = message.recipients.find((r) => r.recipientId === viewerId);
    if (ownRecipient?.acknowledgedAt) {
      return false;
    }
  }
  return isOpenStatus(message.status);
}
