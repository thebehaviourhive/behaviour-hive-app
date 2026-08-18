"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getChildDisplayName } from "@/lib/childDisplayName";
import { INSTRUMENT_LABELS, type MyInstrumentRequest } from "@/lib/fba/types";
import { QuestionnaireFlow } from "./QuestionnaireFlow";

interface RequestRow {
  id: string;
  fba_id: string;
  instrument_type: MyInstrumentRequest["instrumentType"];
  status: MyInstrumentRequest["status"];
  child_name: string;
  clinician_name: string;
  instruction: string | null;
  created_at: string;
}

function mapRow(row: RequestRow): MyInstrumentRequest {
  return {
    id: row.id,
    fbaId: row.fba_id,
    instrumentType: row.instrument_type,
    status: row.status,
    childName: row.child_name,
    clinicianName: row.clinician_name,
    instruction: row.instruction,
    createdAt: row.created_at,
  };
}

// Self-contained: fetches its own data, renders nothing while loading or
// when there's nothing pending, and owns the completion flow's open/
// closed state internally -- so dropping <QuestionnairePromptCard />
// anywhere in a dashboard's layout is the only integration needed, with
// zero other wiring and zero risk to the rest of the page. Mounted at
// the top of ClinicalSupportSection on the parent dashboard, and
// between the stats row and the morning grid on the teacher dashboard
// -- see each call site for why it takes a className prop instead of
// baking in its own outer spacing. A load failure fails silently
// (logged, not shown) rather than putting an alarming error card
// somewhere for something outside the recipient's control -- this is a
// "nice to have" prompt, not core dashboard content.
export function QuestionnairePromptCard({
  track,
  // Caller-supplied outer spacing/inset only -- deliberately NOT baked
  // into this component, since it's now mounted in genuinely different
  // layout contexts per dashboard (see call sites). Everything about
  // each individual card (colour, icon, copy, behaviour) and the gap-3
  // between multiple stacked ones stays exactly as built regardless of
  // what's passed here.
  className = "",
}: {
  track: "parent" | "teacher" | "sna";
  className?: string;
}) {
  const [requests, setRequests] = useState<MyInstrumentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeRequest, setActiveRequest] = useState<MyInstrumentRequest | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_my_instrument_requests");
    if (error) {
      console.error("Failed to load questionnaire prompts:", error);
      setIsLoading(false);
      return;
    }
    setRequests(((data ?? []) as RequestRow[]).map(mapRow));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (isLoading || requests.length === 0) {
    return null;
  }

  // Since this component returns null above when there's nothing to
  // show, the caller-supplied className never renders as a stray gap
  // on the far more common empty case -- there's no DOM node at all for
  // it to be attached to. gap-3 (not a shared bordered stack) is the
  // fix for the old merged-card look: each pending request below is its
  // own fully separate rounded-2xl/shadow card, same as every other
  // stacked card group on these dashboards.
  const stackClassName = `flex flex-col gap-3 ${className}`;

  return (
    <>
      <div className={stackClassName}>
        {requests.map((request) => {
          const instrumentLabel = INSTRUMENT_LABELS[request.instrumentType];
          const title =
            track === "teacher" || track === "sna"
              ? `${getChildDisplayName(request.childName)}'s clinician has asked you to fill out a ${instrumentLabel} questionnaire`
              : `Your clinician has asked you to fill out a ${instrumentLabel} questionnaire about ${request.childName}`;
          return (
            // Golden "please act today" treatment, mirroring the
            // morning check-in prompt card's actual styling (parent-
            // dashboard/page.tsx's CheckInCard) -- same accent colour,
            // border/background approach and font-semibold weight. A
            // distinct icon (📋 vs the check-in card's ☀️) and this
            // card's own instrument-naming copy are what keep the two
            // visually distinguishable when both are stacked.
            <button
              key={request.id}
              type="button"
              onClick={() => setActiveRequest(request)}
              className="flex w-full items-center gap-3 rounded-2xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-4 text-left shadow-md transition-transform active:scale-[0.99]"
            >
              <span
                aria-hidden
                className="flex h-10 w-10 flex-shrink-0 animate-pulse items-center justify-center rounded-full bg-brand-golden-brown/20 text-lg"
              >
                📋
              </span>
              <span className="flex-1 text-sm font-semibold text-brand-neutral-black">{title}</span>
              <span
                aria-hidden
                className="flex-shrink-0 rounded-full bg-brand-golden-brown px-4 py-2 text-xs font-semibold text-white"
              >
                {request.status === "in_progress" ? "Continue" : "Start"}
              </span>
            </button>
          );
        })}
      </div>

      {activeRequest && (
        <QuestionnaireFlow
          request={activeRequest}
          track={track}
          onClose={() => {
            setActiveRequest(null);
            load();
          }}
          onComplete={() => {
            setActiveRequest(null);
            load();
          }}
        />
      )}
    </>
  );
}
