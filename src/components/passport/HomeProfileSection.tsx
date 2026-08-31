"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface ResponseRow {
  id: string;
  recipient_id: string;
  recipient_name: string;
  status: "sent" | "in_progress" | "completed";
  what_works_at_home: string | null;
  sleep: string | null;
  food: string | null;
  sensory_needs_home: string | null;
  history_before_this_school: string | null;
  previous_settings_feedback: string | null;
  created_at: string;
  completed_at: string | null;
}

const FIELD_LABELS: { key: keyof ResponseRow; label: string }[] = [
  { key: "what_works_at_home", label: "What works at home" },
  { key: "sleep", label: "Sleep" },
  { key: "food", label: "Food" },
  { key: "sensory_needs_home", label: "Sensory needs at home" },
  { key: "history_before_this_school", label: "Before this school" },
  { key: "previous_settings_feedback", label: "What previous settings got wrong" },
];

const STATUS_LABEL: Record<ResponseRow["status"], string> = {
  sent: "Sent — not yet started",
  in_progress: "In progress",
  completed: "Complete",
};

// PRD 3, Stage 3 -- self-contained: fetches its own data, owns its own
// request action, and renders a genuinely empty state when there's
// nothing yet -- same "drop it in, zero other wiring" idiom as
// QuestionnairePromptCard. One row per guardian, rendered separately
// and attributed by name -- never merged into a single view, per the
// standing school-says/home-says rule this feature exists to serve.
export function HomeProfileSection({
  passportId,
  institutionId,
}: {
  passportId: string;
  institutionId: string;
}) {
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_passport_home_profile_responses", {
      p_passport_id: passportId,
    });
    if (error) {
      console.error("Failed to load home profile responses:", error);
      setIsLoading(false);
      return;
    }
    setResponses((data ?? []) as ResponseRow[]);
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
    const { data, error } = await supabase.rpc("request_passport_home_profile", {
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

  return (
    <div className="flex flex-col gap-3">
      {responses.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-sm text-black/50">
          No home profile requested yet. Ask a guardian to share what things are like at home
          for this child.
        </div>
      ) : (
        responses.map((response) => (
          <div
            key={response.id}
            className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-brand-neutral-black">
                {response.recipient_name}
              </p>
              <span
                className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                  response.status === "completed"
                    ? "bg-green-50 text-green-800"
                    : "bg-brand-golden-brown/10 text-brand-golden-brown"
                }`}
              >
                {STATUS_LABEL[response.status]}
              </span>
            </div>

            {response.status === "completed" ? (
              <div className="flex flex-col gap-2.5">
                {FIELD_LABELS.map(({ key, label }) => {
                  const value = response[key] as string | null;
                  if (!value) return null;
                  return (
                    <div key={key}>
                      <p className="text-xs font-semibold text-black/40">{label}</p>
                      <p className="text-sm text-black/70">{value}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-black/50">Waiting for this guardian to respond.</p>
            )}
          </div>
        ))
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
          : responses.length === 0
            ? "Request Home Profile"
            : "Ask another guardian"}
      </button>
    </div>
  );
}
