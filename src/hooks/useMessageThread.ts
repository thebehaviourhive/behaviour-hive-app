"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MessageRecipientCandidate, MessageRole, ThreadMessage } from "@/types/messages";

interface RawCandidateRow {
  recipient_id: string;
  full_name: string | null;
  role: MessageRole;
}

interface RawMessageRow {
  id: string;
  passport_id: string;
  sender_id: string;
  sender_role: MessageRole;
  category_id: string;
  body: string | null;
  response_required: boolean;
  status: ThreadMessage["status"];
  created_at: string;
  abc_log_id: string | null;
  strategy_update: boolean;
  category: { label: string } | { label: string }[] | null;
  recipients: {
    id: string;
    recipient_id: string;
    recipient_role: MessageRole;
    acknowledged_at: string | null;
    read_at: string | null;
  }[];
  replies: { id: string; author_id: string; body: string; created_at: string }[];
}

// PostgREST embeds a to-one FK relationship as an object normally, but the
// generated client types sometimes widen it to an array -- handle both
// rather than assuming one shape.
function firstOrSelf<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

// The single data source for a passport's message thread + who's
// currently eligible to receive one -- shared by the parent and teacher
// (Stage 1) surfaces. Everything here is a straight read/RPC call; RLS
// (can_view_message, the RPCs' own participant checks) is the real
// authorization boundary, not this hook.
export function useMessageThread(passportId: string | null) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [candidates, setCandidates] = useState<MessageRecipientCandidate[]>([]);
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!passportId) {
      setIsLoading(false);
      return;
    }
    setLoadError(null);
    const supabase = createClient();

    const [messagesResult, candidatesResult] = await Promise.all([
      supabase
        .from("messages")
        .select(
          `id, passport_id, sender_id, sender_role, category_id, body, response_required, status, created_at,
           abc_log_id, strategy_update,
           category:message_categories(label),
           recipients:message_recipients(id, recipient_id, recipient_role, acknowledged_at, read_at),
           replies:message_replies(id, author_id, body, created_at)`
        )
        .eq("passport_id", passportId)
        .order("created_at", { ascending: true }),
      supabase.rpc("get_message_recipient_candidates", { p_passport_id: passportId }),
    ]);

    if (messagesResult.error || candidatesResult.error) {
      console.error(
        "Failed to load message thread:",
        messagesResult.error ?? candidatesResult.error
      );
      setLoadError("Couldn't load messages. Please try again.");
      setIsLoading(false);
      return;
    }

    const candidateRows = (candidatesResult.data ?? []) as RawCandidateRow[];
    setCandidates(
      candidateRows.map((row) => ({
        recipientId: row.recipient_id,
        fullName: row.full_name,
        role: row.role,
      }))
    );
    setNameById(
      new Map(
        candidateRows
          .filter((row): row is RawCandidateRow & { full_name: string } => Boolean(row.full_name))
          .map((row) => [row.recipient_id, row.full_name])
      )
    );

    const messageRows = (messagesResult.data ?? []) as unknown as RawMessageRow[];
    setMessages(
      messageRows.map((row) => ({
        id: row.id,
        passportId: row.passport_id,
        // Always null on this hook's own rows -- it only ever queries
        // .eq("passport_id", passportId), a real child thread by
        // construction. See useStaffMessageThread.ts for the sibling.
        institutionId: null,
        senderId: row.sender_id,
        senderRole: row.sender_role,
        categoryId: row.category_id,
        categoryLabel: firstOrSelf(row.category)?.label ?? "Message",
        body: row.body,
        responseRequired: row.response_required,
        status: row.status,
        createdAt: row.created_at,
        abcLogId: row.abc_log_id,
        strategyUpdate: row.strategy_update,
        recipients: (row.recipients ?? []).map((r) => ({
          id: r.id,
          recipientId: r.recipient_id,
          recipientRole: r.recipient_role,
          acknowledgedAt: r.acknowledged_at,
          readAt: r.read_at,
        })),
        replies: (row.replies ?? [])
          .slice()
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((r) => ({ id: r.id, authorId: r.author_id, body: r.body, createdAt: r.created_at })),
      }))
    );
    setIsLoading(false);
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    refresh();
  }, [refresh]);

  return { messages, candidates, nameById, isLoading, loadError, refresh };
}
