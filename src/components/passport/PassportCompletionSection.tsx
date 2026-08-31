"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface RequestRow {
  id: string;
  recipient_name: string | null;
  created_at: string;
}

// PRD 3, Stage 3 -- CORRECTED. No response content to display here --
// the answer IS Section A-D, already rendered elsewhere on this same
// page once filled in. This component's only job is the request action
// and a plain record of who was asked, derived against the passport's
// own section_a_complete rather than any status this table itself
// tracks (it doesn't -- there's nothing to update after a request row
// is inserted). Self-contained, same "drop it in" idiom as the rest of
// this family of components.
export function PassportCompletionSection({
  passportId,
  institutionId,
  sectionAComplete,
}: {
  passportId: string;
  institutionId: string;
  sectionAComplete: boolean;
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
    setRequests((data ?? []) as RequestRow[]);
    setIsLoading(false);
  }, [passportId]);

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

  if (sectionAComplete) {
    return (
      <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-green-800">Section A complete.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {requests.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-sm text-black/50">
          Not yet requested. Ask a guardian to complete this child&apos;s passport.
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
            ? "Request Passport Completion"
            : "Ask another guardian"}
      </button>
    </div>
  );
}
