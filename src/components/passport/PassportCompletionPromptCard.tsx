"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getChildDisplayName } from "@/lib/childDisplayName";

interface RequestRow {
  id: string;
  passport_id: string;
  child_name: string;
  institution_name: string;
  target_section: "a" | "e";
  created_at: string;
}

const SECTION_HREF: Record<"a" | "e", string> = {
  a: "/passport/section-a",
  e: "/passport/section-e",
};

const SECTION_COPY: Record<"a" | "e", (childName: string, institutionName: string) => string> = {
  a: (childName, institutionName) => `${institutionName} has asked you to complete ${childName}'s passport`,
  e: (childName, institutionName) =>
    `${institutionName} has asked you to add ${childName}'s medical & care needs`,
};

// Standing rule, 22 Sept 2026 -- everything on the parent dashboard is
// dismissible. This is a LIVE REQUEST (a teacher/principal is asking
// the parent to do something), so dismiss needs a warning naming what
// it's actually for -- never a generic line -- and the requester must
// see it was dismissed (dismiss_passport_completion_request(), 0291;
// PassportCompletionSection.tsx is where a teacher sees "Dismissed").
// Re-requesting the same guardian (the requester's own existing "Ask
// another guardian" action) clears the dismissal -- see
// request_passport_completion()'s own upsert.
const SECTION_DISMISS_WARNING: Record<"a" | "e", (childName: string) => string> = {
  a: (childName) =>
    `Are you sure you want to dismiss this? It may be needed for completing ${childName}'s passport.`,
  e: (childName) =>
    `Are you sure you want to dismiss this? It may be needed for adding ${childName}'s medical & care needs.`,
};

// PRD 3, Stage 3 -- generalised (migration 0185) to point at either
// Section A or Section E, per each request's own target_section. No
// separate answering surface either way -- the request is a prompt
// pointing at the real section wizard. "Outstanding" is derived
// entirely server-side against the right completion flag for that
// section -- this card disappears the moment that's true, whether or
// not the guardian ever tapped it.
export function PassportCompletionPromptCard({ className = "" }: { className?: string }) {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [confirmDismissId, setConfirmDismissId] = useState<string | null>(null);
  const [isDismissing, setIsDismissing] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_my_passport_completion_requests");
    if (error) {
      console.error("Failed to load passport completion prompts:", error);
      setIsLoading(false);
      return;
    }
    setRequests((data ?? []) as RequestRow[]);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleDismiss(requestId: string) {
    setIsDismissing(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("dismiss_passport_completion_request", { p_request_id: requestId });
    setIsDismissing(false);
    if (error) {
      console.error("Failed to dismiss passport completion request:", error);
      return;
    }
    setConfirmDismissId(null);
    setRequests((prev) => prev.filter((r) => r.id !== requestId));
  }

  if (isLoading || requests.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {requests.map((request) => {
        const childName = getChildDisplayName(request.child_name);
        return (
          <div
            key={request.id}
            className="rounded-2xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-4 shadow-md"
          >
            <Link
              href={SECTION_HREF[request.target_section]}
              className="flex items-center gap-3 text-left transition-transform active:scale-[0.99]"
            >
              <span
                aria-hidden
                className="flex h-10 w-10 flex-shrink-0 animate-pulse items-center justify-center rounded-full bg-brand-golden-brown/20 text-lg"
              >
                📄
              </span>
              <span className="flex-1 text-sm font-semibold text-brand-neutral-black">
                {SECTION_COPY[request.target_section](childName, request.institution_name)}
              </span>
              <span
                aria-hidden
                className="flex-shrink-0 rounded-full bg-brand-golden-brown px-4 py-2 text-xs font-semibold text-white"
              >
                Start
              </span>
            </Link>

            {confirmDismissId === request.id ? (
              <div className="mt-3 rounded-xl bg-white/60 p-3">
                <p className="text-xs text-brand-neutral-black/80">
                  {SECTION_DISMISS_WARNING[request.target_section](childName)}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleDismiss(request.id)}
                    disabled={isDismissing}
                    className="rounded-full bg-brand-golden-brown px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    {isDismissing ? "Dismissing…" : "Yes, dismiss"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDismissId(null)}
                    disabled={isDismissing}
                    className="rounded-full border border-black/10 px-4 py-1.5 text-xs font-semibold text-black/60"
                  >
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDismissId(request.id)}
                className="mt-2 text-xs font-semibold text-brand-neutral-black/50"
              >
                Not needed?
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
