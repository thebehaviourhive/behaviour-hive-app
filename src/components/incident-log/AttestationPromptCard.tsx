"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Phase 4, piece 2. The entry point named staff actually have a reason
// to notice -- an SNA who witnessed something on a colleague's incident
// has no reason to open that incident's own record, so this has to live
// on THEIR dashboard, not inside a page they'd never navigate to.
// Matches QuestionnairePromptCard's own idiom (same golden-brown
// "please act" card, self-contained, renders nothing while loading or
// when there's nothing outstanding) rather than inventing a new one.
//
// Count is deliberately NOT every row get_my_incident_attestations()
// returns -- withdrawn is a completed decision, not an outstanding
// task (a badge that keeps nagging someone who withdrew would push
// them back toward re-attesting just to clear it, corrupting the exact
// signal withdrawal exists to carry), and closed (post-signoff)
// incidents are frozen, nothing left to prompt about. Only not_attested
// and stale count.
interface AttestationRow {
  incident_id: string;
  status: string;
  is_closed: boolean;
}

export function AttestationPromptCard({ className = "" }: { className?: string }) {
  const [outstandingCount, setOutstandingCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_my_incident_attestations");
      if (!isMounted) return;
      if (error) {
        console.error("Failed to load incident attestations:", error);
        setIsLoading(false);
        return;
      }
      const rows = (data ?? []) as AttestationRow[];
      const count = rows.filter((r) => !r.is_closed && (r.status === "not_attested" || r.status === "stale")).length;
      setOutstandingCount(count);
      setIsLoading(false);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, []);

  if (isLoading || outstandingCount === 0) {
    return null;
  }

  return (
    <Link
      href="/teacher/incidents/attestations"
      className={`flex w-full items-center gap-3 rounded-2xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-4 text-left shadow-md transition-transform active:scale-[0.99] ${className}`}
    >
      <span
        aria-hidden
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-golden-brown/20 text-lg"
      >
        📝
      </span>
      <span className="flex-1 text-sm font-semibold text-brand-neutral-black">
        {outstandingCount === 1
          ? "You're named on an incident record that needs your attestation"
          : `You're named on ${outstandingCount} incident records that need your attestation`}
      </span>
      <span
        aria-hidden
        className="flex-shrink-0 rounded-full bg-brand-golden-brown px-4 py-2 text-xs font-semibold text-white"
      >
        Review
      </span>
    </Link>
  );
}
