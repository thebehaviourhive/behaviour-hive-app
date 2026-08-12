"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/logActivity";
import {
  INSTRUMENT_LABELS,
  RECIPIENT_ROLE_LABELS,
  type FbaInstrumentRequest,
  type FbaRecipientCandidate,
  type InstrumentRequestStatus,
  type InstrumentResponsesData,
  type InstrumentRequestType,
  type RecipientRole,
  type SendableInstrumentType,
} from "@/lib/fba/types";

interface RequestRow {
  id: string;
  // Broader than what can be SENT (SendableInstrumentType) -- this reads
  // whatever's already in the table, including the one legacy
  // open_ended request from before migration 0044.
  instrument_type: InstrumentRequestType;
  recipient_id: string;
  recipient_name: string | null;
  recipient_role: RecipientRole;
  status: InstrumentRequestStatus;
  responses_data: InstrumentResponsesData;
  instruction: string | null;
  created_at: string;
  completed_at: string | null;
  last_reminded_at: string | null;
}

interface CandidateRow {
  recipient_id: string;
  full_name: string | null;
  role: RecipientRole;
}

function mapRequest(row: RequestRow): FbaInstrumentRequest {
  return {
    id: row.id,
    instrumentType: row.instrument_type,
    recipientId: row.recipient_id,
    recipientName: row.recipient_name ?? "Unknown",
    recipientRole: row.recipient_role,
    status: row.status,
    responsesData: row.responses_data ?? {},
    instruction: row.instruction,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    lastRemindedAt: row.last_reminded_at,
  };
}

function mapCandidate(row: CandidateRow): FbaRecipientCandidate {
  return { recipientId: row.recipient_id, fullName: row.full_name ?? "Unknown", role: row.role };
}

// Postgres unique-violation, surfaced when the client-side duplicate-
// request precheck missed a race -- the DB-level partial unique index
// (migration 0041) is the actual guarantee.
const UNIQUE_VIOLATION = "23505";

// Backs Section 7's Send Questionnaire flow and tracking chips: the
// clinician's own two-RPC view of a single FBA's questionnaire activity
// (get_fba_instrument_requests + get_fba_recipient_candidates), plus the
// two write actions a clinician can take on this table (send a new
// request, send a reminder on an existing one).
export function useFbaInstrumentRequests(fbaId: string, passportId: string | undefined) {
  const [requests, setRequests] = useState<FbaInstrumentRequest[]>([]);
  const [candidates, setCandidates] = useState<FbaRecipientCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();

    const [{ data: reqData, error: reqError }, { data: candData, error: candError }] = await Promise.all([
      supabase.rpc("get_fba_instrument_requests", { p_fba_id: fbaId }),
      supabase.rpc("get_fba_recipient_candidates", { p_fba_id: fbaId }),
    ]);

    if (reqError || candError) {
      console.error("Failed to load instrument requests:", reqError ?? candError);
      setLoadError("Couldn't load questionnaire data.");
      setIsLoading(false);
      return;
    }

    setRequests(((reqData ?? []) as RequestRow[]).map(mapRequest));
    setCandidates(((candData ?? []) as CandidateRow[]).map(mapCandidate));
    setIsLoading(false);
  }, [fbaId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function sendRequest(
    instrumentType: SendableInstrumentType,
    recipientId: string,
    instruction: string
  ): Promise<string | null> {
    if (!passportId) return "Missing passport.";

    const alreadyActive = requests.some(
      (r) => r.instrumentType === instrumentType && r.recipientId === recipientId && r.status !== "completed"
    );
    if (alreadyActive) {
      return "An active request for this instrument and recipient already exists.";
    }

    const supabase = createClient();
    const { error } = await supabase.from("fba_instrument_requests").insert({
      fba_id: fbaId,
      passport_id: passportId,
      instrument_type: instrumentType,
      recipient_id: recipientId,
      status: "sent",
      instruction: instruction.trim() ? instruction : null,
    });

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return "An active request for this instrument and recipient already exists.";
      }
      console.error("Failed to send questionnaire:", error);
      return "Couldn't send the questionnaire. Please try again.";
    }

    // Clinician-feed-only (see the visibility matrix, migration 0049) --
    // "clinicians tracking their own sends is useful". Never reaches
    // the parent or teacher feed: questionnaire_sent/completed are
    // deliberately absent from both the parent policy's visible set
    // and get_teacher_activity_feed()'s allow-list.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const recipientRole = candidates.find((c) => c.recipientId === recipientId)?.role;
      logActivity({
        passportId,
        actorId: user.id,
        eventType: "questionnaire_sent",
        eventDescription: `${INSTRUMENT_LABELS[instrumentType]} sent to ${recipientRole ? RECIPIENT_ROLE_LABELS[recipientRole] : "recipient"}`,
      });
    }

    await load();
    return null;
  }

  async function sendReminder(requestId: string): Promise<string | null> {
    const supabase = createClient();
    const { error } = await supabase
      .from("fba_instrument_requests")
      .update({ last_reminded_at: new Date().toISOString() })
      .eq("id", requestId);

    if (error) {
      console.error("Failed to send reminder:", error);
      return "Couldn't send a reminder. Please try again.";
    }

    await load();
    return null;
  }

  return { requests, candidates, isLoading, loadError, reload: load, sendRequest, sendReminder };
}
