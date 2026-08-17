"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MessageRecipientCandidate, MessageRole } from "@/types/messages";

interface RawCandidateRow {
  recipient_id: string;
  full_name: string | null;
  role: MessageRole;
}

// Candidates-only -- get_message_recipient_candidates without the full
// messages list `useMessageThread` also fetches. For spots that only
// need "who can I message about this child" (the ABC-log and strategy-
// update notify flows), pulling the whole thread alongside it would be
// pure waste.
export function useMessageRecipientCandidates(passportId: string | null) {
  const [candidates, setCandidates] = useState<MessageRecipientCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!passportId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCandidates([]);
      setIsLoading(false);
      return;
    }
    let isMounted = true;

    async function load() {
      setIsLoading(true);
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_message_recipient_candidates", {
        p_passport_id: passportId,
      });
      if (!isMounted) return;
      if (error) {
        console.error("Failed to load message recipient candidates:", error);
        setCandidates([]);
        setIsLoading(false);
        return;
      }
      setCandidates(
        ((data ?? []) as RawCandidateRow[]).map((row) => ({
          recipientId: row.recipient_id,
          fullName: row.full_name,
          role: row.role,
        }))
      );
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [passportId]);

  return { candidates, isLoading };
}
