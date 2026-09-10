"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface RequestRow {
  id: string;
  recipient_name: string | null;
  target_section: "a" | "e";
  created_at: string;
}

const SECTION_LABEL: Record<"a" | "e", string> = {
  a: "passport",
  e: "medical & care needs",
};

// PRD 3, Stage 3 -- generalised (migration 0185) to request either
// Section A or Section E, per the caller's own targetSection prop. No
// response content to display here regardless of which -- the answer
// IS the section itself, already rendered elsewhere on this same page
// once filled in. This component's only job is the request action and
// a plain record of who was asked, derived against the passport's own
// completion flag (section_a_complete or passport_section_e.
// section_e_complete) rather than any status this table itself tracks.
export function PassportCompletionSection({
  passportId,
  institutionId,
  targetSection,
  isSectionComplete,
}: {
  passportId: string;
  institutionId: string;
  targetSection: "a" | "e";
  isSectionComplete: boolean;
}) {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_passport_completion_requests", {
      p_passport_id: passportId,
    });
    if (error) {
      console.error("Failed to load passport completion requests:", error);
      setIsLoading(false);
      return;
    }
    setRequests(((data ?? []) as RequestRow[]).filter((r) => r.target_section === targetSection));
    setIsLoading(false);
  }, [passportId, targetSection]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleRequest() {
    setIsRequesting(true);
    setRequestError(null);
    setRequestSuccess(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("request_passport_completion", {
      p_passport_id: passportId,
      p_institution_id: institutionId,
      p_target_section: targetSection,
    });
    setIsRequesting(false);
    if (error) {
      setRequestError(error.message);
      return;
    }
    setRequestSuccess(
      data === 1 ? "Request sent to 1 guardian." : `Request sent to ${data} guardians.`
    );
    load();
  }

  if (isLoading) {
    return null;
  }

  if (isSectionComplete) {
    return (
      <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-green-800">
          {targetSection === "a" ? "Section A complete." : "Medical & care needs complete."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {requests.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-sm text-black/50">
          Not yet requested. Ask a guardian to complete this child&apos;s {SECTION_LABEL[targetSection]}.
        </div>
      ) : (
        <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold text-black/40">Requested from</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {requests.map((r) => (
              <li key={r.id} className="text-sm text-black/70">
                {r.recipient_name ?? "A guardian"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {requestError && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {requestError}
        </p>
      )}
      {requestSuccess && (
        <p className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          {requestSuccess}
        </p>
      )}

      <button
        type="button"
        onClick={handleRequest}
        disabled={isRequesting}
        className="w-full rounded-2xl border-2 border-brand-prussian-blue py-3 text-sm font-semibold text-brand-prussian-blue disabled:opacity-50"
      >
        {isRequesting
          ? "Sending…"
          : requests.length === 0
            ? targetSection === "a"
              ? "Request Passport Completion"
              : "Request Medical & Care Needs"
            : "Ask another guardian"}
      </button>
    </div>
  );
}
