"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { DeactivateStaffSheet } from "@/components/principal/DeactivateStaffSheet";
import { ReviewStaffJoinSheet } from "@/components/principal/ReviewStaffJoinSheet";
import { PrincipalBottomNav } from "@/components/principal/PrincipalBottomNav";

// Staff Lifecycle Stage 1, Step 3 (+ Stage 1b: pending as a third row-
// state, approve/reject, rejected history). Tone matches the rest of
// this module's principal-facing surfaces: administrative and precise.
//
// PRD 2, Stage 1: Hand Over moved to /principal/school, under its own
// "Account Administration" heading -- the design's own instruction,
// "findable without hunting, never adjacent to routine actions." This
// page keeps approve/reject/deactivate only.
//
// PRD 2, Stage 2: reskin + deep-link, no new plumbing beyond 0125's own
// roster widening (deactivated_at/deactivation_reason -- the roster RPC
// itself had nothing to show a deactivation date with before that).
// Segmented Pending/Active/Deactivated replaces the old flat list, one
// query, three client-side filters over the same rows -- not three
// separate fetches. "Deactivated staff are never hidden" is why this is
// a segment, not a hidden state: the Deactivated segment is one tap
// away, never a filter someone has to think to apply.

type Segment = "pending" | "active" | "deactivated";

interface StaffRow {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
  is_pending: boolean;
  deactivated_at: string | null;
  deactivation_reason: string | null;
}

interface RejectedRow {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
  rejected_at: string;
  rejected_by_name: string | null;
  rejection_reason: string;
}

const ROLE_LABEL: Record<string, string> = {
  class_teacher: "Class Teacher",
  sna: "SNA",
  principal: "Principal",
  institution_admin: "Institution Admin",
};

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "active", label: "Active" },
  { key: "deactivated", label: "Deactivated" },
];

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function PrincipalStaffPage() {
  const { user, isReady } = useRequireRole("principal");
  const searchParams = useSearchParams();
  // Deep-link target, read once at mount -- matching this app's own
  // established pattern (the clinician passport page's own ?tab= read):
  // an invalid/unknown value falls back to "active" rather than
  // rendering nothing, and manually switching segments afterwards is
  // plain local state, not synced back to the URL.
  const [segment, setSegment] = useState<Segment>(() => {
    const requested = searchParams.get("segment");
    return SEGMENTS.some((s) => s.key === requested) ? (requested as Segment) : "active";
  });
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [rejected, setRejected] = useState<RejectedRow[]>([]);
  const [showRejectedHistory, setShowRejectedHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<StaffRow | null>(null);
  const [reviewTarget, setReviewTarget] = useState<StaffRow | null>(null);

  const load = useCallback(async (instId: string) => {
    const supabase = createClient();
    const [rosterResult, rejectedResult] = await Promise.all([
      supabase.rpc("get_institution_staff_roster", {
        p_institution_id: instId,
        p_include_inactive: true,
        p_include_pending: true,
      }),
      supabase.rpc("get_rejected_staff_joins", { p_institution_id: instId }),
    ]);
    if (rosterResult.error) {
      setError("Could not load the staff list.");
      setIsLoading(false);
      return;
    }
    setStaff((rosterResult.data ?? []) as StaffRow[]);
    // Not fatal on its own -- the main list is the page's real job, and a
    // failed history fetch shouldn't block it. Left empty rather than
    // surfacing a second error banner for a secondary section.
    setRejected(rejectedResult.error ? [] : ((rejectedResult.data ?? []) as RejectedRow[]));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function resolveInstitutionAndLoad() {
      const supabase = createClient();
      // deactivated_at is null here even though a deactivated principal
      // isn't reachable yet (see CLAUDE.md, Deferred work) -- Stage 1b
      // makes it reachable, and this lookup should already be correct
      // for that day rather than need a second pass then. approved_at is
      // not null is the same kind of forward-correctness: a pending or
      // rejected principal is also structurally unreachable today (same
      // note), but this page shouldn't need revisiting once it is.
      const { data: staffRow, error: staffError } = await supabase
        .from("institution_staff")
        .select("institution_id")
        .eq("user_id", user!.id)
        .eq("role", "principal")
        .is("deactivated_at", null)
        .not("approved_at", "is", null)
        .maybeSingle();

      if (!isMounted) return;

      if (staffError || !staffRow) {
        setError("Could not find your institution.");
        setIsLoading(false);
        return;
      }

      setInstitutionId(staffRow.institution_id);
      await load(staffRow.institution_id);
    }

    resolveInstitutionAndLoad();
    return () => {
      isMounted = false;
    };
  }, [user, load]);

  if (!isReady) {
    return null;
  }

  const pending = staff.filter((s) => s.is_pending);
  const active = staff.filter((s) => s.is_active);
  const deactivated = staff.filter((s) => !s.is_pending && !s.is_active);
  const bySegment: Record<Segment, StaffRow[]> = { pending, active, deactivated };
  const visible = bySegment[segment];

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Staff</h1>
      </header>

      {!isLoading && !error && (
        <div className="mb-4 flex gap-2 px-4">
          {SEGMENTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSegment(s.key)}
              className={`flex-1 rounded-xl border py-2 text-sm font-semibold ${
                segment === s.key
                  ? "border-brand-prussian-blue bg-brand-pastel-blue/10 text-brand-prussian-blue"
                  : "border-black/10 text-brand-neutral-black/60"
              }`}
            >
              {s.label} ({bySegment[s.key].length})
            </button>
          ))}
        </div>
      )}

      <main className="flex-1 px-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : error ? (
          <p className="text-sm text-brand-neutral-black/60">{error}</p>
        ) : staff.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
            No staff registered at this school yet.
          </p>
        ) : visible.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
            {segment === "pending"
              ? "No pending requests."
              : segment === "active"
                ? "No active staff."
                : "No deactivated staff."}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map((member) => (
              <StaffCard
                key={member.user_id}
                member={member}
                isSelf={member.user_id === user?.id}
                onDeactivate={() => setDeactivateTarget(member)}
                onReview={() => setReviewTarget(member)}
              />
            ))}
          </div>
        )}

        {/* The design spec's own static card, per Daniel's correction:
            belongs here AND at the point a search fails to find someone
            (GrantTemporaryAccessSheet's own lookup-failure message
            already covers that second place -- "No Behaviour Hive
            account found... they must sign up first"). This is the
            first of the two, not a duplicate of it. Active-only: a
            principal reading Pending or Deactivated isn't the one
            wondering "how do I add someone new". */}
        {!isLoading && !error && segment === "active" && (
          <p className="mt-4 rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-xs text-brand-neutral-black/50">
            A supply teacher must create their own Behaviour Hive account before you can grant them access — there is
            no way to invite someone by email.
          </p>
        )}

        {!isLoading && !error && segment === "pending" && rejected.length > 0 && (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setShowRejectedHistory((v) => !v)}
              className="flex w-full items-center justify-between rounded-2xl border border-dashed border-black/10 bg-white/60 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50"
            >
              <span>Rejected requests ({rejected.length})</span>
              <span>{showRejectedHistory ? "−" : "+"}</span>
            </button>

            {showRejectedHistory && (
              <div className="mt-2 flex flex-col gap-2">
                {rejected.map((row) => (
                  <div key={row.id} className="rounded-2xl border border-black/5 bg-white/60 p-4">
                    <p className="text-sm font-semibold text-brand-neutral-black">{row.full_name}</p>
                    <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                      {ROLE_LABEL[row.role] ?? row.role} · rejected {formatDate(row.rejected_at)}
                      {row.rejected_by_name ? ` by ${row.rejected_by_name}` : ""}
                    </p>
                    <p className="mt-2 text-sm text-brand-neutral-black/70">&ldquo;{row.rejection_reason}&rdquo;</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {deactivateTarget && institutionId && (
        <DeactivateStaffSheet
          member={deactivateTarget}
          isOpen={Boolean(deactivateTarget)}
          onClose={() => setDeactivateTarget(null)}
          onDeactivated={() => {
            setDeactivateTarget(null);
            load(institutionId);
          }}
        />
      )}

      {reviewTarget && institutionId && (
        <ReviewStaffJoinSheet
          member={reviewTarget}
          isOpen={Boolean(reviewTarget)}
          onClose={() => setReviewTarget(null)}
          onResolved={() => {
            setReviewTarget(null);
            load(institutionId);
          }}
        />
      )}

      <PrincipalBottomNav />
    </div>
  );
}

function StaffCard({
  member,
  isSelf,
  onDeactivate,
  onReview,
}: {
  member: StaffRow;
  isSelf: boolean;
  onDeactivate: () => void;
  onReview: () => void;
}) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-brand-neutral-black">
            {member.full_name}
            {isSelf && <span className="text-brand-neutral-black/50"> (you)</span>}
          </p>
          <p className="mt-0.5 text-xs text-brand-neutral-black/50">{ROLE_LABEL[member.role] ?? member.role}</p>
        </div>
        {member.deactivated_at && (
          <span className="flex-shrink-0 rounded-full bg-brand-golden-brown/15 px-2.5 py-1 text-xs font-semibold text-brand-golden-brown">
            DEACTIVATED {formatDate(member.deactivated_at).toUpperCase()}
          </span>
        )}
      </div>

      {/* Everything they wrote stays on the record in their name -- this
          card is the same discipline: the reason they left is visible
          here, not just recorded and hidden. */}
      {member.deactivation_reason && (
        <p className="mt-2 text-sm text-brand-neutral-black/70">&ldquo;{member.deactivation_reason}&rdquo;</p>
      )}

      {member.is_pending && (
        <button
          type="button"
          onClick={onReview}
          className="mt-3 block w-full rounded-xl bg-brand-prussian-blue py-2 text-center text-xs font-semibold text-white"
        >
          Review Request
        </button>
      )}

      {/* Hand Over moved to /principal/school -- see this page's own
          header comment. isSelf's own principal branch no longer needs
          a card action here. */}

      {member.is_active && !isSelf && (
        <button
          type="button"
          onClick={onDeactivate}
          className="mt-3 block w-full rounded-xl border border-brand-golden-brown py-2 text-center text-xs font-semibold text-brand-golden-brown"
        >
          Deactivate
        </button>
      )}
    </div>
  );
}
