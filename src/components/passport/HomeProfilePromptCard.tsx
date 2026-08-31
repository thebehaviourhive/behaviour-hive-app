"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getChildDisplayName } from "@/lib/childDisplayName";

interface RequestRow {
  id: string;
  passport_id: string;
  status: "sent" | "in_progress" | "completed";
  child_name: string;
  institution_name: string;
  created_at: string;
}

// PRD 3, Stage 3 -- self-contained, same idiom as QuestionnairePromptCard:
// fetches its own data, renders nothing while loading or when there's
// nothing outstanding, so dropping <HomeProfilePromptCard /> anywhere is
// the only integration needed. A genuinely separate feed from
// get_my_instrument_requests() (this is get_my_passport_profile_requests(),
// a different table entirely) -- kept as its own card rather than merged
// into QuestionnairePromptCard's list, since a home profile request
// isn't from a clinician and shouldn't read like one.
export function HomeProfilePromptCard({ className = "" }: { className?: string }) {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_my_passport_profile_requests");
    if (error) {
      console.error("Failed to load home profile prompts:", error);
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

  if (isLoading || requests.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {requests.map((request) => (
        <Link
          key={request.id}
          href={`/passport/home-profile/${request.id}`}
          className="flex w-full items-center gap-3 rounded-2xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-4 text-left shadow-md transition-transform active:scale-[0.99]"
        >
          <span
            aria-hidden
            className="flex h-10 w-10 flex-shrink-0 animate-pulse items-center justify-center rounded-full bg-brand-golden-brown/20 text-lg"
          >
            🏠
          </span>
          <span className="flex-1 text-sm font-semibold text-brand-neutral-black">
            {request.institution_name} has asked you to share what things are like at home for{" "}
            {getChildDisplayName(request.child_name)}
          </span>
          <span
            aria-hidden
            className="flex-shrink-0 rounded-full bg-brand-golden-brown px-4 py-2 text-xs font-semibold text-white"
          >
            {request.status === "in_progress" ? "Continue" : "Start"}
          </span>
        </Link>
      ))}
    </div>
  );
}
