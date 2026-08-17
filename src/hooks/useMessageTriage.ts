"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MessageRole, ThreadMessage } from "@/types/messages";

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
  }[];
  replies: { id: string; author_id: string; body: string; created_at: string }[];
}

function firstOrSelf<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export interface TriageGroup {
  passportId: string;
  displayName: string;
  messages: ThreadMessage[];
}

// The cross-caseload triage view's data source -- shared by the teacher
// track (redacted display names) and the clinician track (full names).
// Entirely role-agnostic: it takes a plain {passportId, displayName}[]
// and lets RLS (can_view_message) decide what each caller actually sees
// per passport -- a teacher's rows are their own sent/received traffic
// only, a clinician's rows also include the read-only parent<->teacher
// stream for that case (MessageCard renders that distinction, not this
// hook).
export function useMessageTriage(passports: { passportId: string; displayName: string }[]) {
  const [messagesByPassport, setMessagesByPassport] = useState<Map<string, ThreadMessage[]>>(new Map());
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const idsKey = passports.map((p) => p.passportId).sort().join(",");

  const refresh = useCallback(async () => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) {
      setMessagesByPassport(new Map());
      setIsLoading(false);
      return;
    }
    setLoadError(null);
    const supabase = createClient();

    const [messagesResult, ...candidateResults] = await Promise.all([
      supabase
        .from("messages")
        .select(
          `id, passport_id, sender_id, sender_role, category_id, body, response_required, status, created_at,
           abc_log_id, strategy_update,
           category:message_categories(label),
           recipients:message_recipients(id, recipient_id, recipient_role, acknowledged_at),
           replies:message_replies(id, author_id, body, created_at)`
        )
        .in("passport_id", ids)
        .order("created_at", { ascending: true }),
      ...ids.map((id) => supabase.rpc("get_message_recipient_candidates", { p_passport_id: id })),
    ]);

    if (messagesResult.error) {
      console.error("Failed to load message triage:", messagesResult.error);
      setLoadError("Couldn't load messages. Please try again.");
      setIsLoading(false);
      return;
    }

    const mergedNameById = new Map<string, string>();
    candidateResults.forEach((result) => {
      ((result.data ?? []) as RawCandidateRow[]).forEach((row) => {
        if (row.full_name) mergedNameById.set(row.recipient_id, row.full_name);
      });
    });
    setNameById(mergedNameById);

    const grouped = new Map<string, ThreadMessage[]>();
    ((messagesResult.data ?? []) as unknown as RawMessageRow[]).forEach((row) => {
      const message: ThreadMessage = {
        id: row.id,
        passportId: row.passport_id,
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
        })),
        replies: (row.replies ?? [])
          .slice()
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((r) => ({ id: r.id, authorId: r.author_id, body: r.body, createdAt: r.created_at })),
      };
      const existing = grouped.get(row.passport_id) ?? [];
      existing.push(message);
      grouped.set(row.passport_id, existing);
    });

    setMessagesByPassport(grouped);
    setIsLoading(false);
  }, [idsKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    refresh();
  }, [refresh]);

  const groups = useMemo<TriageGroup[]>(() => {
    return passports
      .map((p) => ({ passportId: p.passportId, displayName: p.displayName, messages: messagesByPassport.get(p.passportId) ?? [] }))
      .filter((g) => g.messages.length > 0)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [passports, messagesByPassport]);

  return { groups, nameById, isLoading, loadError, refresh };
}
