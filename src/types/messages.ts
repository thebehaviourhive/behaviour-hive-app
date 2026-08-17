// Shared types for the Messages feature (asynchronous ticketing).
// Stage 1: data model + core lifecycle only -- see supabase/migrations/
// 0061_messages_ticketing.sql for the schema and RPCs these mirror.

export type MessageRole = "parent" | "class_teacher" | "clinician";

export type MessageStatus = "open" | "acknowledged" | "in_discussion" | "closed";

export const ROLE_LABEL: Record<MessageRole, string> = {
  parent: "Parent",
  class_teacher: "Class Teacher",
  clinician: "Clinician",
};

export interface MessageCategory {
  id: string;
  label: string;
  description: string | null;
  allowedSenderRoles: MessageRole[];
  sortOrder: number;
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
  passportId: string;
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
}
