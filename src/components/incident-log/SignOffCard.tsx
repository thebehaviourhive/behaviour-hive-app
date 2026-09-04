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
//
// CONFIRM-SHEET REWORK (Daniel's own finding: "generic permanence copy
// in front of a button labelled the same as the one that opened it is
// not a decision point"). Two changes:
//
// 1. The sheet now names what's actually being signed -- child(ren),
//    date, whether restraint was used -- passed down from the parent
//    page's own already-loaded state (childNames/occurredAtLabel/
//    restraintUsed props). No new RPC: the parent already has all
//    three for the report itself.
//
// 2. WITHDRAWN ATTESTATIONS get their own, more prominent block,
//    separate from the generic "Blocking sign-off" list -- Daniel's own
//    framing: "someone present does not stand over this account" is not
//    the same class of problem as a missing debrief. A currently-
//    withdrawn one can never coexist with this confirm sheet being open
//    (withdraw_attestation() itself requires teacher_signed_at is null,
//    same gate as attest_to_incident() -- confirmed reading both bodies
//    before writing this, not assumed) -- so what CAN reach this screen
//    is WITHDRAWAL HISTORY: someone who withdrew and later re-attested.
//    build_staff_attestations_summary() has always returned
//    withdrawn_at/withdrawal_reason for every row regardless of current
//    status (0149); SignOffCard's own StaffAttestation interface just
//    never declared those fields. Restated in the confirm sheet too --
//    a teacher signing off should know an account was disputed and
//    resolved, not just that it currently reads clean.

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
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
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
  // The stale-snapshot bug (CLAUDE.md, "a stale snapshot looks exactly
  // like a failed write"): this card used to fetch
  // get_incident_signoff_summary() once, keyed on incidentId, which
  // never changes for the lifetime of this page. A teacher answering
  // "Was anyone injured?" wrote successfully, but this card kept
  // showing "not recorded" from before the answer -- a display bug
  // wearing the exact symptom of the write-layer bug item 1 was
  // originally about, diagnosed as the same thing once, wrongly.
  //
  // refreshSignal is a plain counter the PARENT page bumps after every
  // write that touches anything incident_signoff_issues(),
  // build_staff_attestations_summary(), or compute_incident_content_
  // hash() reads -- see that page's own bumpSignoffSummary() call
  // sites for the full, named list. Included in the load effect's own
  // dependency array below so a bump forces a genuine refetch, the
  // same shape as the incident page's own reloadKey, just scoped to
  // this one card instead of the whole page.
  refreshSignal: number;
  // What's being signed, straight from the parent page's own already-
  // loaded state -- no new fetch.
  childNames: string[];
  occurredAtLabel: string;
  restraintUsed: boolean;
}

export function SignOffCard({
  incidentId,
  onSignedOff,
  refreshSignal,
  childNames,
  occurredAtLabel,
  restraintUsed,
}: SignOffCardProps) {
  const [summary, setSummary] = useState<SignoffSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  // The signature moment (Daniel's own framing, applied to both halves
  // of this record's own close-out for consistency -- CountersignCard
  // carries the identical pattern, see its own header comment for the
  // full reasoning). SignOffCard's own stale-render risk was already
  // masked by the whole-page reload (isLocked flips true and unmounts
  // this component entirely), but "the last irreversible act should
  // feel like a signature, not a dismissal" describes this action just
  // as much as countersigning -- an instant close read as thin here
  // too, not just where the bug was.
  const [showSuccess, setShowSuccess] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);

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
  }, [incidentId, refreshSignal]);

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
    // The signature moment, not an instant close -- see this state's
    // own declaration above. onSignedOff() (the full-page reload) fires
    // once it's been visible for a beat, not immediately -- the page
    // transforming to its read-only state is itself a strong signal,
    // but it shouldn't arrive so fast the confirmation never registers.
    setShowSuccess(true);
  }

  useEffect(() => {
    if (!showSuccess) return;
    const raf = requestAnimationFrame(() => setSuccessVisible(true));
    const timer = setTimeout(() => {
      setSuccessVisible(false);
      setShowSuccess(false);
      setIsConfirmOpen(false);
      // Reload rather than patch local state -- sign-off changes what's
      // editable, what's visible, and what section renders where across
      // this whole page (debrief, actions, injuries, body map, welfare
      // fields all become read-only at once); a full refetch from the
      // server is the only way to guarantee everything derived from
      // teacher_signed_at is correct after the transition, not just the
      // few fields this component itself touched.
      onSignedOff();
    }, 1400);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSuccess]);

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
  // Withdrawn is its own class of blocking issue, not a variant of
  // "stale" or a missing debrief -- see this file's own header comment.
  const withdrawnBlockingStaff = blockingStaff.filter((s) => s.status === "withdrawn");
  const otherBlockingStaff = blockingStaff.filter((s) => s.status !== "withdrawn");
  // Ever-withdrawn, regardless of current status -- can only be
  // non-blocking (i.e. re-attested) if this screen is reachable at all,
  // since a live withdrawal blocks the button outright. Still worth
  // knowing: the record was disputed at some point, not just that it
  // currently reads clean.
  const resolvedWithdrawalHistory = summary.staff_attestations.filter(
    (s) => s.withdrawn_at && s.status !== "withdrawn"
  );
  // The aggregate stale/withdrawn count from blocking_issues is dropped
  // in favour of naming the actual people below -- more actionable than
  // "1 staff member(s)" when the summary already knows exactly who.
  const nonStaffBlockingIssues = summary.blocking_issues.filter((i) => i.code !== "stale_or_withdrawn_attestation");
  const hasNonBlockingNotes = notYetAttested.length > 0 || summary.anyone_injured.note !== null;
  const hasBlockingContent = nonStaffBlockingIssues.length > 0 || otherBlockingStaff.length > 0;

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

      {/* Withdrawn attestations -- its own block, heavier weight than
          the generic blocking box below it. Can only ever be reached
          while a withdrawal is genuinely outstanding (blocks_signoff),
          which is exactly when it matters most. */}
      {withdrawnBlockingStaff.length > 0 && (
        <div className="rounded-2xl border-2 border-brand-golden-brown bg-brand-golden-brown/15 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-golden-brown">
            Withdrawn attestation -- not currently stood over
          </p>
          <ul className="mt-2 flex flex-col gap-2 text-sm text-brand-neutral-black">
            {withdrawnBlockingStaff.map((s) => (
              <li key={s.incident_staff_id}>
                <span className="font-semibold">{s.name}</span> withdrew their attestation
                {s.withdrawal_reason && <span className="italic"> -- &quot;{s.withdrawal_reason}&quot;</span>}
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
            {otherBlockingStaff.map((s) => (
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

      <BottomSheet isOpen={isConfirmOpen} onClose={() => !isSigning && !showSuccess && setIsConfirmOpen(false)}>
        {showSuccess ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span
              aria-hidden
              className={`flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl transition-all duration-300 ${
                successVisible ? "scale-100 opacity-100" : "scale-50 opacity-0"
              }`}
            >
              ✅
            </span>
            <p className="font-heading text-lg font-semibold text-brand-neutral-black">Signed off</p>
            <p className="text-sm text-brand-neutral-black/60">A principal countersign is next.</p>
          </div>
        ) : (
          <>
            <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Sign off?</h2>

            {/* What's being signed -- named, not implied. */}
            <div className="mt-3 rounded-2xl border border-black/5 bg-black/[0.02] p-3.5">
              <p className="text-sm font-semibold text-brand-neutral-black">
                {childNames.length > 0 ? childNames.join(", ") : "This incident"}
              </p>
              <p className="mt-0.5 text-xs text-brand-neutral-black/60">{occurredAtLabel}</p>
              <p className={`mt-1.5 text-xs font-semibold ${restraintUsed ? "text-brand-golden-brown" : "text-brand-neutral-black/50"}`}>
                {restraintUsed ? "Restraint (CPI) was used" : "No restraint used"}
              </p>
            </div>

            {resolvedWithdrawalHistory.length > 0 && (
              <div className="mt-3 rounded-xl border border-brand-golden-brown/30 bg-brand-golden-brown/10 p-3">
                <p className="text-xs font-semibold text-brand-golden-brown">
                  {resolvedWithdrawalHistory.map((s) => s.name).join(", ")} withdrew{" "}
                  {resolvedWithdrawalHistory.length === 1 ? "an attestation" : "attestations"} on this record, then
                  re-attested. Resolved, not currently blocking -- worth knowing before you sign.
                </p>
              </div>
            )}

            <p className="mt-3 text-sm text-brand-neutral-black/70">
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
          </>
        )}
      </BottomSheet>
    </div>
  );
}
