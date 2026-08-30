"use client";

import { useCallback, useEffect, useState } from "react";
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

interface StaffRow {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
  is_pending: boolean;
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

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function PrincipalStaffPage() {
  const { user, isReady } = useRequireRole("principal");
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

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Staff</h1>
      </header>

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
        ) : (
          <div className="flex flex-col gap-2">
            {staff.map((member) => (
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

        {!isLoading && !error && rejected.length > 0 && (
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
  const statusLabel = member.is_pending ? "Pending" : member.is_active ? "Active" : "Deactivated";
  const statusClass = member.is_pending
    ? "bg-brand-golden-brown/15 text-brand-golden-brown"
    : member.is_active
      ? "bg-brand-pastel-blue/20 text-brand-prussian-blue"
      : "bg-black/5 text-brand-neutral-black/60";

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
        <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

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
