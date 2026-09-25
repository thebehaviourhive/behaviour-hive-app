"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Respite UI Stage 2b -- the Messages screen's own single data source.
// get_my_handover_messages() (migration 0311) already restates the
// real read gate (activation open, sender-or-recipient) -- this hook
// only groups and sorts what it returns.
export interface HandoverMessage {
  messageId: string;
  passportId: string;
  childName: string;
  senderId: string;
  senderName: string | null;
  body: string | null;
  createdAt: string;
  isRead: boolean;
}

export interface HandoverGroup {
  passportId: string;
  childName: string;
  messages: HandoverMessage[];
  unreadCount: number;
  latestCreatedAt: string;
}

interface RawRow {
  message_id: string;
  passport_id: string;
  child_name: string | null;
  sender_id: string;
  sender_name: string | null;
  body: string | null;
  created_at: string;
  is_read: boolean;
}

export function useHandoverInbox(institutionId: string | null) {
  const [messages, setMessages] = useState<HandoverMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!institutionId) {
      setIsLoading(false);
      return;
    }
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_my_handover_messages", { p_institution_id: institutionId });
    if (error) {
      console.error("Failed to load handover messages:", error);
      setLoadError("Couldn't load messages. Please try again.");
      setIsLoading(false);
      return;
    }
    setMessages(
      ((data ?? []) as RawRow[]).map((row) => ({
        messageId: row.message_id,
        passportId: row.passport_id,
        childName: row.child_name ?? "This child",
        senderId: row.sender_id,
        senderName: row.sender_name,
        body: row.body,
        createdAt: row.created_at,
        isRead: row.is_read,
      }))
    );
    setIsLoading(false);
  }, [institutionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    refresh();
  }, [refresh]);

  const markRead = useCallback(
    async (messageId: string) => {
      setMessages((prev) => prev.map((m) => (m.messageId === messageId ? { ...m, isRead: true } : m)));
      const supabase = createClient();
      await supabase.rpc("mark_message_read", { p_message_id: messageId });
    },
    []
  );

  // GROUPED BY CHILD, not a flat chronological list -- a handover is
  // inherently about one child, and the reader's real question ("what
  // was left for me") is "which of MY children have something new,"
  // not "what happened most recently regardless of who it's about." A
  // flat list of thirty children's worth of handovers interleaved by
  // time is harder to scan for exactly the person this screen is for
  // -- someone walking onto shift who needs to know, per child, what
  // changed. Grouping also caps naturally: most children have a
  // handful of recent handovers, never thirty of them each.
  const groups = useMemo<HandoverGroup[]>(() => {
    const byChild = new Map<string, HandoverMessage[]>();
    for (const m of messages) {
      const list = byChild.get(m.passportId) ?? [];
      list.push(m);
      byChild.set(m.passportId, list);
    }
    const result: HandoverGroup[] = [];
    for (const [passportId, msgs] of byChild) {
      const sorted = [...msgs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      result.push({
        passportId,
        childName: sorted[0].childName,
        messages: sorted,
        unreadCount: sorted.filter((m) => !m.isRead).length,
        latestCreatedAt: sorted[0].createdAt,
      });
    }
    // Unread-first -- "make unread the thing the eye lands on," per
    // the brief -- then most recently active child.
    result.sort((a, b) => {
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
      if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
      return new Date(b.latestCreatedAt).getTime() - new Date(a.latestCreatedAt).getTime();
    });
    return result;
  }, [messages]);

  const totalUnread = useMemo(() => messages.filter((m) => !m.isRead).length, [messages]);

  return { groups, totalUnread, isLoading, loadError, refresh, markRead };
}
