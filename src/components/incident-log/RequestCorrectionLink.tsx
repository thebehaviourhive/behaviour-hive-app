"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ComposeMessageSheet } from "@/components/messages/ComposeMessageSheet";
import { useMessageCategories } from "@/hooks/useMessageCategories";
import type { MessageRecipientCandidate, MessageRole } from "@/types/messages";

// Amendment access lockdown, item 4 (CLAUDE.md). Amendments are
// principal-only as of migration 0180 -- an owning teacher (or a named
// SNA) who realises later that something's wrong has no route left to
// self-correct. Daniel's own instinct: the existing staff-to-staff
// messaging channel (migration 0168's "General" category, class_teacher
// -> principal, already live) is enough for the trial rather than a new
// structured-request workflow -- but only if it's actually findable from
// here, not something a teacher has to already know exists and go
// looking for. This is that link: quiet, on the signed-off record
// itself, pre-selecting the principal and the category and pre-filling
// a plain-text reference to which incident -- messages has no
// incident_id column (0061), so the reference has to travel as text.
//
// Deliberately gated on viewerRole !== "principal": a countersigning
// principal already has their own direct route (CountersignCard's own
// persistent "Add an amendment" button, same migration) -- this exists
// specifically for the role that lost self-amendment, not for the one
// that already has a better option.
export function RequestCorrectionLink({
  institutionId,
  viewerRole,
  occurredAtLabel,
}: {
  institutionId: string;
  viewerRole: MessageRole;
  occurredAtLabel: string;
}) {
  const [candidates, setCandidates] = useState<MessageRecipientCandidate[] | null>(null);
  const [institutionPhone, setInstitutionPhone] = useState<string | null>(null);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const { categories } = useMessageCategories(viewerRole, "staff");

  useEffect(() => {
    let isMounted = true;
    async function load() {
      const supabase = createClient();
      const [candidatesResult, institutionResult] = await Promise.all([
        supabase.rpc("get_institution_staff_candidates", { p_institution_id: institutionId }),
        supabase.from("institutions").select("phone").eq("id", institutionId).maybeSingle(),
      ]);
      if (!isMounted) return;
      if (candidatesResult.error) {
        console.error("Failed to load staff candidates for correction link:", candidatesResult.error);
        setCandidates([]);
      } else {
        setCandidates(
          (candidatesResult.data ?? []).map(
            (row: { recipient_id: string; full_name: string | null; role: MessageRole }) => ({
              recipientId: row.recipient_id,
              fullName: row.full_name,
              role: row.role,
            })
          )
        );
      }
      setInstitutionPhone(institutionResult.data?.phone ?? null);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [institutionId]);

  if (candidates === null || categories.length === 0) return null;

  const principal = candidates.find((c) => c.role === "principal");
  const generalCategory = categories.find((c) => c.label === "General") ?? categories[0];

  // Honest degrade, not a broken link (Daniel's own instruction) --
  // C-08/principal-handover (CLAUDE.md, Deferred work) means an
  // institution can genuinely be between principals for a while. This
  // names that plainly rather than offering a compose sheet with nobody
  // to send to.
  if (!principal) {
    return (
      <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-sm text-brand-neutral-black/60">
        Need a correction to this record? This school doesn&apos;t currently have an active principal to message --
        contact Behaviour Hive support to arrange this.
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsComposeOpen(true)}
        className="rounded-2xl border border-black/10 bg-white p-4 text-left text-sm text-brand-neutral-black transition-colors hover:bg-black/[0.02]"
      >
        Need a correction to this record?{" "}
        <span className="font-semibold text-brand-prussian-blue">
          Message {principal.fullName ?? "the principal"}
        </span>
        .
      </button>
      <ComposeMessageSheet
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        institutionId={institutionId}
        candidates={candidates}
        categories={categories}
        institutionPhone={institutionPhone}
        onSent={() => setIsComposeOpen(false)}
        initialCategoryId={generalCategory?.id}
        initialRecipientIds={[principal.recipientId]}
        initialBody={`Re: incident on ${occurredAtLabel} -- need a correction: `}
      />
    </>
  );
}
