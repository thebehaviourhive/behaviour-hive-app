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

  if (isLoading || requests.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {requests.map((request) => (
        <Link
          key={request.id}
          href={SECTION_HREF[request.target_section]}
          className="flex w-full items-center gap-3 rounded-2xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-4 text-left shadow-md transition-transform active:scale-[0.99]"
        >
          <span
            aria-hidden
            className="flex h-10 w-10 flex-shrink-0 animate-pulse items-center justify-center rounded-full bg-brand-golden-brown/20 text-lg"
          >
            📄
          </span>
          <span className="flex-1 text-sm font-semibold text-brand-neutral-black">
            {SECTION_COPY[request.target_section](
              getChildDisplayName(request.child_name),
              request.institution_name
            )}
          </span>
          <span
            aria-hidden
            className="flex-shrink-0 rounded-full bg-brand-golden-brown px-4 py-2 text-xs font-semibold text-white"
          >
            Start
          </span>
        </Link>
      ))}
    </div>
  );
}
