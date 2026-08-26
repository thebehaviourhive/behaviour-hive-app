"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";

// Phase 4, piece 1. Sign-off readiness + the one irreversible action on
// this record. Rendered only by the parent page, only for the owning
// teacher, only pre-signoff -- this component doesn't re-derive that.
//
// Everything shown here comes straight off get_incident_signoff_summary()/
// sign_off_incident(), both built on the SAME shared incident_signoff_
// issues() the database trigger itself consumes (migration 0085) -- what
// this card shows and what the database actually enforces structurally
// cannot drift apart.
//
// Blocking and non-blocking are kept visually AND textually separate, per
// the brief: a missing attestation and an unanswered "was anyone
// injured" are listed but never block; a stale/withdrawn attestation, an
// outstanding required debrief, and the three consistency checks do. A
// teacher should never hit a sign-off error they couldn't see coming
// here first, and should never be scared off by something that isn't
// actually stopping them -- hence two clearly labelled boxes, not one
// undifferentiated list.

interface BlockingIssue {
  code: string;
  message: string;
}

interface StaffAttestation {
  incident_staff_id: string;
  name: string;
  has_account: boolean;
  status: string;
  status_label: string;
  blocks_signoff: boolean;
}

interface SignoffSummary {
  can_sign_off: boolean;
  blocking_issues: BlockingIssue[];
  staff_attestations: StaffAttestation[];
  anyone_injured: { value: boolean | null; note: string | null };
}

interface SignOffCardProps {
  incidentId: string;
  onSignedOff: () => void;
}

export function SignOffCard({ incidentId, onSignedOff }: SignOffCardProps) {
  const [summary, setSummary] = useState<SignoffSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_incident_signoff_summary", {
        p_incident_id: incidentId,
      });
      if (!isMounted) return;
      if (error) {
        setLoadError(error.message);
      } else {
        setSummary(data as SignoffSummary);
      }
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [incidentId]);

  async function handleConfirmSignOff() {
    setIsSigning(true);
    setSignError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("sign_off_incident", { p_incident_id: incidentId });
    setIsSigning(false);
    if (error) {
      // Shouldn't normally happen -- the summary above already reflects
      // what would block -- but state can move between load and confirm
      // (another gate tripped, someone else edited), and the RPC's own
      // error is the actual, current, database-verified reason, not a
      // client guess. Shown here rather than silently retried.
      setSignError(error.message);
      return;
    }
    setIsConfirmOpen(false);
    // Reload rather than patch local state -- sign-off changes what's
    // editable, what's visible, and what section renders where across
    // this whole page (debrief, actions, injuries, body map, welfare
    // fields all become read-only at once); a full refetch from the
    // server is the only way to guarantee everything derived from
    // teacher_signed_at is correct after the transition, not just the
    // few fields this component itself touched.
    onSignedOff();
  }

  if (isLoading) {
    return <div className="h-24 animate-pulse rounded-2xl bg-brand-off-white/60" />;
  }

  if (loadError || !summary) {
    return (
      <p role="alert" className="text-sm font-medium text-red-600">
        Couldn&apos;t load sign-off readiness: {loadError ?? "unknown error"}
      </p>
    );
  }

  const notYetAttested = summary.staff_attestations.filter((s) => s.status === "not_attested");
  const blockingStaff = summary.staff_attestations.filter((s) => s.blocks_signoff);
  // The aggregate stale/withdrawn count from blocking_issues is dropped
  // in favour of naming the actual people below -- more actionable than
  // "1 staff member(s)" when the summary already knows exactly who.
  const nonStaffBlockingIssues = summary.blocking_issues.filter((i) => i.code !== "stale_or_withdrawn_attestation");
  const hasNonBlockingNotes = notYetAttested.length > 0 || summary.anyone_injured.note !== null;
  const hasBlockingContent = nonStaffBlockingIssues.length > 0 || blockingStaff.length > 0;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <h2 className="font-heading text-lg font-bold text-brand-prussian-blue">Sign-off</h2>

      {hasNonBlockingNotes && (
        <div className="rounded-2xl border border-dashed border-black/10 bg-black/[0.02] p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
            Not yet resolved -- will not block sign-off
          </p>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm text-brand-neutral-black/70">
            {summary.anyone_injured.note && (
              <li>&quot;Was a student or staff member injured?&quot; -- not recorded</li>
            )}
            {notYetAttested.map((s) => (
              <li key={s.incident_staff_id}>
                {s.name} -- {s.status_label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasBlockingContent && (
        <div className="rounded-2xl border border-brand-golden-brown/30 bg-brand-golden-brown/10 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-golden-brown">Blocking sign-off</p>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm text-brand-neutral-black">
            {nonStaffBlockingIssues.map((issue) => (
              <li key={issue.code}>{issue.message.replace(/^Cannot sign off -- /, "")}</li>
            ))}
            {blockingStaff.map((s) => (
              <li key={s.incident_staff_id}>
                {s.name} -- {s.status_label} attestation
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.can_sign_off ? (
        <Button type="button" onClick={() => setIsConfirmOpen(true)}>
          Sign off
        </Button>
      ) : (
        <>
          <Button type="button" disabled>
            Sign off
          </Button>
          <p className="text-center text-xs text-brand-neutral-black/50">Resolve the items above before signing off.</p>
        </>
      )}

      <BottomSheet isOpen={isConfirmOpen} onClose={() => !isSigning && setIsConfirmOpen(false)}>
        <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Sign off?</h2>
        <p className="mt-2 text-sm text-brand-neutral-black/70">
          This is permanent. Once signed off, this incident becomes read-only and can never be edited again --
          any correction from here goes through an append-only amendment, never an edit. A principal
          countersign is required next.
        </p>

        {signError && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-600">
            {signError}
          </p>
        )}

        <Button type="button" onClick={handleConfirmSignOff} disabled={isSigning} className="mt-6">
          {isSigning ? "Signing off…" : "Sign off"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setIsConfirmOpen(false)}
          disabled={isSigning}
          className="mt-2 !border-black/10 !text-black/60"
        >
          Cancel
        </Button>
      </BottomSheet>
    </div>
  );
}
