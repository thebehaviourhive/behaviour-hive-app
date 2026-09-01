"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DeactivateStaffSheet } from "@/components/principal/DeactivateStaffSheet";
import { ReviewStaffJoinSheet } from "@/components/principal/ReviewStaffJoinSheet";
import type { StaffRow } from "./StaffDetail";

// PRD 4, Stage 4 -- extracted from principal/staff/page.tsx. Below lg,
// renders exactly what that page always has: full rows with their own
// inline Review/Deactivate actions, no separate detail concept (staff
// never had one). At lg+, rows collapse to compact (name, role, status)
// and become selectable -- the same actions move into StaffDetail, the
// split view's right pane, via onSelect.
//
// Segmented Pending/Active/Deactivated is unchanged from before this
// stage; still one query, three client-side filters over the same rows.

type Segment = "pending" | "active" | "deactivated";

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

export function StaffList({
  currentUserId,
  selectedUserId,
  onSelect,
  refreshToken,
}: {
  currentUserId: string | undefined;
  selectedUserId: string | null;
  onSelect: (member: StaffRow) => void;
  // Bumped by the parent whenever a sheet in StaffDetail resolves --
  // this list owns its own fetch (self-contained, matching every other
  // list/detail pair in this stage), so it needs an external nudge to
  // reload rather than the detail pane reaching back into it directly.
  refreshToken: number;
}) {
  const [segment, setSegment] = useState<Segment>("active");
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [rejected, setRejected] = useState<RejectedRow[]>([]);
  const [showRejectedHistory, setShowRejectedHistory] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deactivateSelfTarget, setDeactivateSelfTarget] = useState<StaffRow | null>(null);
  const [reviewSelfTarget, setReviewSelfTarget] = useState<StaffRow | null>(null);

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
    setRejected(rejectedResult.error ? [] : ((rejectedResult.data ?? []) as RejectedRow[]));
    setIsLoading(false);
  }, []);

  const [institutionId, setInstitutionId] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUserId) return;
    let isMounted = true;
    async function resolveInstitutionAndLoad() {
      const supabase = createClient();
      const { data: staffRow, error: staffError } = await supabase
        .from("institution_staff")
        .select("institution_id")
        .eq("user_id", currentUserId!)
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
  }, [currentUserId, load]);

  useEffect(() => {
    if (!institutionId || refreshToken === 0) return;
    async function run() {
      await load(institutionId!);
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const pending = staff.filter((s) => s.is_pending);
  const active = staff.filter((s) => s.is_active);
  const deactivated = staff.filter((s) => !s.is_pending && !s.is_active);
  const bySegment: Record<Segment, StaffRow[]> = { pending, active, deactivated };
  const visible = bySegment[segment];

  return (
    <>
      {!isLoading && !error && (
        <div className="mb-4 flex gap-2">
          {SEGMENTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSegment(s.key)}
              className={`flex-1 rounded-xl border py-2 font-sans text-body font-semibold ${
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

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
        </div>
      ) : error ? (
        <p className="font-sans text-body text-brand-neutral-black/60">{error}</p>
      ) : staff.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
          No staff registered at this school yet.
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
          {segment === "pending" ? "No pending requests." : segment === "active" ? "No active staff." : "No deactivated staff."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((member) => {
            const isSelf = member.user_id === currentUserId;
            const isSelected = member.user_id === selectedUserId;
            return (
              <button
                key={member.user_id}
                type="button"
                onClick={() => onSelect(member)}
                className={`rounded-2xl border p-4 text-left shadow-sm transition-colors lg:bg-white ${
                  isSelected ? "border-brand-prussian-blue bg-brand-pastel-blue/10" : "border-black/5 bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-heading text-h2 font-semibold text-brand-prussian-blue lg:text-body lg:font-semibold lg:text-brand-neutral-black">
                      {member.full_name}
                      {isSelf && <span className="text-brand-neutral-black/50"> (you)</span>}
                    </p>
                    <p className="mt-0.5 font-sans text-body text-brand-neutral-black/50 lg:text-eyebrow">
                      {ROLE_LABEL[member.role] ?? member.role}
                    </p>
                  </div>
                  {member.deactivated_at && (
                    <span className="flex-shrink-0 rounded-full bg-brand-golden-brown/15 px-2.5 py-1 font-accent text-eyebrow font-bold text-brand-golden-brown">
                      Deactivated
                    </span>
                  )}
                </div>

                {/* Full row content + inline actions -- below lg only,
                    exactly as this page always rendered before this
                    stage. At lg+ the same actions live in StaffDetail,
                    the right pane, once a row is selected. */}
                <div className="lg:hidden">
                  {member.deactivation_reason && (
                    <p className="mt-2 font-sans text-body text-brand-neutral-black/70">&ldquo;{member.deactivation_reason}&rdquo;</p>
                  )}
                  {member.is_pending && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setReviewSelfTarget(member);
                      }}
                      className="mt-3 block w-full rounded-xl bg-brand-prussian-blue py-2 text-center font-sans text-body font-semibold text-white"
                    >
                      Review Request
                    </span>
                  )}
                  {member.is_active && !isSelf && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeactivateSelfTarget(member);
                      }}
                      className="mt-3 block w-full rounded-xl border border-brand-golden-brown py-2 text-center font-sans text-body font-semibold text-brand-golden-brown"
                    >
                      Deactivate
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!isLoading && !error && segment === "active" && (
        <p className="mt-4 rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-eyebrow text-brand-neutral-black/50">
          A supply teacher must create their own Behaviour Hive account before you can grant them access — there is
          no way to invite someone by email.
        </p>
      )}

      {!isLoading && !error && segment === "pending" && rejected.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowRejectedHistory((v) => !v)}
            className="flex w-full items-center justify-between rounded-2xl border border-dashed border-black/10 bg-white/60 px-4 py-3 text-left font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50"
          >
            <span>Rejected requests ({rejected.length})</span>
            <span>{showRejectedHistory ? "−" : "+"}</span>
          </button>

          {showRejectedHistory && (
            <div className="mt-2 flex flex-col gap-2">
              {rejected.map((row) => (
                <div key={row.id} className="rounded-2xl border border-black/5 bg-white/60 p-4">
                  <p className="font-sans text-body font-semibold text-brand-neutral-black">{row.full_name}</p>
                  <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/50">
                    {ROLE_LABEL[row.role] ?? row.role} · rejected {formatDate(row.rejected_at)}
                    {row.rejected_by_name ? ` by ${row.rejected_by_name}` : ""}
                  </p>
                  <p className="mt-2 font-sans text-body text-brand-neutral-black/70">&ldquo;{row.rejection_reason}&rdquo;</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Below-lg-only sheets, driven by the row's own inline actions --
          mirrors exactly what staff/page.tsx did before this stage. At
          lg+ these same two sheets live inside StaffDetail instead,
          triggered from the right pane. */}
      {deactivateSelfTarget && (
        <DeactivateStaffSheet
          member={deactivateSelfTarget}
          isOpen
          onClose={() => setDeactivateSelfTarget(null)}
          onDeactivated={() => {
            setDeactivateSelfTarget(null);
            if (institutionId) load(institutionId);
          }}
        />
      )}
      {reviewSelfTarget && (
        <ReviewStaffJoinSheet
          member={reviewSelfTarget}
          isOpen
          onClose={() => setReviewSelfTarget(null)}
          onResolved={() => {
            setReviewSelfTarget(null);
            if (institutionId) load(institutionId);
          }}
        />
      )}
    </>
  );
}
