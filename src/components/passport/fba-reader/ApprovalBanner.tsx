"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Part D's approval prompt. Self-contained: checks whether extraction
// has already happened (via a plain read on passport_clinical_content,
// which the parent already has unconditional SELECT on) so it never
// re-prompts after approval, and only reveals itself once the parent
// has scrolled most of the way through the report -- not on page load,
// so it doesn't compete with actually reading the assessment. "Not now"
// hides it for this visit only; reloading or reopening the reader
// re-prompts, satisfying "remains reachable... until approved" without
// needing anywhere to persist a dismissal.
export function ApprovalBanner({ fbaId, childName }: { fbaId: string; childName: string | null }) {
  const [isChecking, setIsChecking] = useState(true);
  const [isApproved, setIsApproved] = useState(false);
  const [hasScrolledNearEnd, setHasScrolledNearEnd] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase
      .from("passport_clinical_content")
      .select("id", { count: "exact", head: true })
      .eq("source_document_type", "fba_report")
      .eq("source_document_id", fbaId)
      .then(({ count }) => {
        if (!isMounted) return;
        setIsApproved((count ?? 0) > 0);
        setIsChecking(false);
      });
    return () => {
      isMounted = false;
    };
  }, [fbaId]);

  useEffect(() => {
    function handleScroll() {
      const doc = document.documentElement;
      const scrolledFraction = (window.scrollY + window.innerHeight) / doc.scrollHeight;
      if (scrolledFraction > 0.85) setHasScrolledNearEnd(true);
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  async function handleApprove() {
    setError(null);
    setIsApproving(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("approve_fba_strategies", { p_fba_id: fbaId });
    setIsApproving(false);
    if (rpcError) {
      console.error("Failed to approve FBA strategies:", rpcError);
      setError("Couldn't publish these updates. Please try again.");
      return;
    }
    setIsApproved(true);
  }

  if (isChecking || isApproved || !hasScrolledNearEnd || isDismissed) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-white p-4 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
      <p className="mb-3 text-sm font-medium text-brand-neutral-black">
        Approve updated strategies from the FBA into {childName ?? "your child"}&apos;s passport?
      </p>
      {error && <p className="mb-2 text-xs font-medium text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          disabled={isApproving}
          className="flex-1 rounded-2xl border-2 border-black/10 py-3 text-sm font-semibold text-black/60 disabled:opacity-40"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={handleApprove}
          disabled={isApproving}
          className="flex-1 rounded-2xl bg-brand-prussian-blue py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isApproving ? "Publishing…" : "Approve & Publish"}
        </button>
      </div>
    </div>
  );
}
