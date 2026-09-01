"use client";

import { useState } from "react";
import { DeactivateStaffSheet } from "@/components/principal/DeactivateStaffSheet";
import { ReviewStaffJoinSheet } from "@/components/principal/ReviewStaffJoinSheet";

// PRD 4, Stage 4 -- the Directory split view's right pane for the Staff
// segment. Content and actions match StaffCard exactly (principal/
// staff/page.tsx's own row component, still used unchanged below lg)
// -- Review Request / Deactivate open the same two sheets, reused, not
// reimplemented. Self-contained: owns its own sheet-open state, takes
// the already-selected row and reports back via onChanged so the list
// beside it can refetch.

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
  isSelf,
  onChanged,
}: {
  member: StaffRow;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [isReviewOpen, setIsReviewOpen] = useState(false);

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-heading text-h2 font-semibold text-brand-prussian-blue">
            {member.full_name}
            {isSelf && <span className="text-brand-neutral-black/50"> (you)</span>}
          </p>
          <p className="mt-0.5 font-sans text-body text-brand-neutral-black/50">{ROLE_LABEL[member.role] ?? member.role}</p>
        </div>
        {member.deactivated_at && (
          <span className="flex-shrink-0 rounded-full bg-brand-golden-brown/15 px-2.5 py-1 font-accent text-eyebrow font-bold text-brand-golden-brown">
            Deactivated {formatDate(member.deactivated_at)}
          </span>
        )}
      </div>

      {/* Everything they wrote stays on the record in their name -- this
          card is the same discipline: the reason they left is visible
          here, not just recorded and hidden. */}
      {member.deactivation_reason && (
        <p className="mt-3 font-sans text-body text-brand-neutral-black/70">&ldquo;{member.deactivation_reason}&rdquo;</p>
      )}

      {member.is_pending && (
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

      {member.is_active && !isSelf && (
        <button
          type="button"
          onClick={() => setIsDeactivateOpen(true)}
          className="mt-4 block w-full rounded-xl border border-brand-golden-brown py-2.5 text-center font-sans text-body font-semibold text-brand-golden-brown"
        >
          Deactivate
        </button>
      )}

      <DeactivateStaffSheet
        member={member}
        isOpen={isDeactivateOpen}
        onClose={() => setIsDeactivateOpen(false)}
        onDeactivated={() => {
          setIsDeactivateOpen(false);
          onChanged();
        }}
      />

      <ReviewStaffJoinSheet
        member={member}
        isOpen={isReviewOpen}
        onClose={() => setIsReviewOpen(false)}
        onResolved={() => {
          setIsReviewOpen(false);
          onChanged();
        }}
      />
    </div>
  );
}
