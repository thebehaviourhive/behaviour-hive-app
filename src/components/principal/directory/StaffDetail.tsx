"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DeactivateStaffSheet } from "@/components/principal/DeactivateStaffSheet";
import { ReviewStaffJoinSheet } from "@/components/principal/ReviewStaffJoinSheet";

// PRD 4, Stage 4 -- the Directory split view's right pane for the Staff
// segment. Content and actions match StaffCard exactly (principal/
// staff/page.tsx's own row component, still used unchanged below lg)
// -- Review Request / Deactivate open the same two sheets, reused, not
// reimplemented. Self-contained: owns its own sheet-open state, takes
// the already-selected row and reports back via onChanged so the list
// beside it can refetch.
//
// Stale-snapshot fix (CLAUDE.md's own documented bug class, confirmed
// here by a sweep of every fetch+mutation component in the app):
// deactivating or resolving a join request from THIS pane used to only
// call onChanged(), which bumps a refresh token that reaches the
// sibling StaffList and never this component -- the pane stayed
// mounted, still rendering the pre-mutation `member` prop, looking
// exactly like the click had done nothing. Fixed the same way
// AttestationCard/SignOffCard/CountersignCard were: this component now
// owns its own copy of the row (`staffRow`, seeded from `member` and
// re-fetched by user_id on both mount/selection-change AND its own two
// mutations succeeding) rather than rendering the prop directly.
// onChanged() is still called too, so the sibling list keeps refreshing
// as before -- this is additive, not a replacement for that signal.

export interface StaffRow {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
  is_pending: boolean;
  deactivated_at: string | null;
  deactivation_reason: string | null;
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

export function StaffDetail({
  member,
  institutionId,
  isSelf,
  onChanged,
}: {
  member: StaffRow;
  institutionId: string;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  // Seeded from the prop so selecting a row shows something instantly;
  // kept current afterward by this component's own fetch, never by the
  // prop alone -- see the header comment.
  const [staffRow, setStaffRow] = useState<StaffRow>(member);

  async function fetchStaffRow(): Promise<StaffRow | null> {
    const supabase = createClient();
    const { data } = await supabase.rpc("get_institution_staff_roster", {
      p_institution_id: institutionId,
      p_include_inactive: true,
      p_include_pending: true,
    });
    return ((data ?? []) as StaffRow[]).find((r) => r.id === member.id) ?? null;
  }

  useEffect(() => {
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStaffRow(member);
    async function load() {
      const fresh = await fetchStaffRow();
      if (!isMounted || !fresh) return;
      setStaffRow(fresh);
    }
    load();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.id]);

  async function refreshAfterMutation() {
    const fresh = await fetchStaffRow();
    if (fresh) setStaffRow(fresh);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-heading text-h2 font-semibold text-brand-prussian-blue">
            {staffRow.full_name}
            {isSelf && <span className="text-brand-neutral-black/50"> (you)</span>}
          </p>
          <p className="mt-0.5 font-sans text-body text-brand-neutral-black/50">{ROLE_LABEL[staffRow.role] ?? staffRow.role}</p>
        </div>
        {staffRow.deactivated_at && (
          <span className="flex-shrink-0 rounded-full bg-brand-golden-brown/15 px-2.5 py-1 font-accent text-eyebrow font-bold text-brand-golden-brown">
            Deactivated {formatDate(staffRow.deactivated_at)}
          </span>
        )}
      </div>

      {/* Everything they wrote stays on the record in their name -- this
          card is the same discipline: the reason they left is visible
          here, not just recorded and hidden. */}
      {staffRow.deactivation_reason && (
        <p className="mt-3 font-sans text-body text-brand-neutral-black/70">&ldquo;{staffRow.deactivation_reason}&rdquo;</p>
      )}

      {staffRow.is_pending && (
        <button
          type="button"
          onClick={() => setIsReviewOpen(true)}
          className="mt-4 block w-full rounded-xl bg-brand-prussian-blue py-2.5 text-center font-sans text-body font-semibold text-white"
        >
          Review Request
        </button>
      )}

      {/* Hand Over lives on /principal/school -- isSelf's own principal
          branch needs no action here, matching staff/page.tsx's own
          established reasoning. */}

      {staffRow.is_active && !isSelf && (
        <button
          type="button"
          onClick={() => setIsDeactivateOpen(true)}
          className="mt-4 block w-full rounded-xl border border-brand-golden-brown py-2.5 text-center font-sans text-body font-semibold text-brand-golden-brown"
        >
          Deactivate
        </button>
      )}

      <DeactivateStaffSheet
        member={staffRow}
        isOpen={isDeactivateOpen}
        onClose={() => setIsDeactivateOpen(false)}
        onDeactivated={async () => {
          setIsDeactivateOpen(false);
          onChanged();
          await refreshAfterMutation();
        }}
      />

      <ReviewStaffJoinSheet
        member={staffRow}
        isOpen={isReviewOpen}
        onClose={() => setIsReviewOpen(false)}
        onResolved={async () => {
          setIsReviewOpen(false);
          onChanged();
          await refreshAfterMutation();
        }}
      />
    </div>
  );
}
