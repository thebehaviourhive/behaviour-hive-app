// Shared types for the Messages feature (asynchronous ticketing).
// Stage 1: data model + core lifecycle only -- see supabase/migrations/
// 0061_messages_ticketing.sql for the schema and RPCs these mirror.

// "principal" added -- a principal can now both be addressed (a new
// recipient branch on get_message_recipient_candidates()) and start a
// thread (a new sender branch on send_message(), scoped to children
// enrolled at their own institution). "Threads they are addressed on,
// nothing else" was the rule for READING -- can_view_message() -- not
// for who may send; Daniel's own correction, see migration 0161.
//
// "sna" added -- migration 0168, staff-to-staff messaging (small
// version). An SNA can now send/receive a STAFF thread only -- SNA on
// CHILD threads is a separate, deliberately deferred piece (see
// CLAUDE.md). MessageRole doesn't distinguish the two; can_view_message()
// and send_message() do, server-side, via messages.institution_id.
export type MessageRole = "parent" | "class_teacher" | "clinician" | "principal" | "sna";

export type MessageStatus = "open" | "acknowledged" | "in_discussion" | "closed";

export const ROLE_LABEL: Record<MessageRole, string> = {
  parent: "Parent",
  class_teacher: "Class Teacher",
  clinician: "Clinician",
  principal: "Principal",
  sna: "SNA",
};

export interface MessageCategory {
  id: string;
  label: string;
  description: string | null;
  allowedSenderRoles: MessageRole[];
  sortOrder: number;
  // migration 0168 -- ties a category to which kind of message it's
  // valid on. send_message() enforces this server-side; the client
  // filters by it too so a picker never offers a mismatched category.
  appliesTo: "child" | "staff";
}

// A candidate returned by get_message_recipient_candidates -- who a
// sender can currently pick from. Also doubles as this app's only name
// directory for a passport's active participants (see useMessageThread's
// nameById).
export interface MessageRecipientCandidate {
  recipientId: string;
  fullName: string | null;
  role: MessageRole;
}

export interface MessageRecipient {
  id: string;
  recipientId: string;
  recipientRole: MessageRole;
  acknowledgedAt: string | null;
}

export interface MessageReply {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface ThreadMessage {
  id: string;
  // migration 0168 -- exactly one of passportId/institutionId is ever
  // set (messages_exactly_one_scope, enforced at the DB). A staff
  // thread carries institutionId and a null passportId.
  passportId: string | null;
  institutionId: string | null;
  senderId: string;
  senderRole: MessageRole;
  categoryId: string;
  categoryLabel: string;
  body: string | null;
  responseRequired: boolean;
  status: MessageStatus;
  createdAt: string;
  recipients: MessageRecipient[];
  replies: MessageReply[];
  // Stage 3A: set when this message references an ABC incident log.
  abcLogId: string | null;
  // Stage 3B: set on clinician-sent "Strategy update" messages -- drives
  // the compact per-recipient receipt view on the Clinical File tab.
  strategyUpdate: boolean;
}
