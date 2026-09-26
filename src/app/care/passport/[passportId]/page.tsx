"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionMembership } from "@/hooks/useInstitutionMembership";
import { RespiteChildRecord } from "@/components/respite/RespiteChildRecord";
import { CareBottomNav } from "@/components/respite/CareBottomNav";

// PRD 11 Stage 5, item 4 -- the first-five-minutes screen, care_staff's
// own route. Activation-scoped read throughout -- see migration 0302
// and the shared RespiteChildRecord component for the full shape.
//
// Respite UI Stage 2b -- CareBottomNav added; this route had no nav at
// all before (no layout.tsx existed anywhere under /care/*), the exact
// "a care worker inside a child's record with no nav can't get
// anywhere" gap named directly.
export default function CareStaffPassportPage() {
  const params = useParams<{ passportId: string }>();
  const passportId = params.passportId;
  const { user, isReady } = useRequireRole("care_staff");
  const membership = useInstitutionMembership(user?.id, "care_staff");
  // Baseline audit, 26 Sept 2026 -- lifted from RespiteChildRecord's own
  // onChildNameChange, the same shape principal's own passport detail
  // page uses via ChildDetail, since this page has no other source for
  // the child's name to put beside its back-chevron.
  const [childName, setChildName] = useState<string | null>(null);

  if (!isReady || membership.status !== "approved" || !user || !membership.institutionId) {
    return null;
  }

  return (
    <>
    <main className="min-h-full bg-brand-off-white/40 px-4 py-4 pb-24 lg:pb-4">
      {/* Baseline audit, 26 Sept 2026 -- this was the single densest
          screen in the product with zero back-chevron matches anywhere
          in the respite track. Same component and aria-label as
          principal/passports/[passportId]/page.tsx's own header, back
          to the dashboard this route is always reached from. */}
      <header className="flex items-center gap-3 pb-4">
        <Link
          href="/care/dashboard"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="flex-1 font-heading text-xl font-bold text-brand-prussian-blue">{childName ?? "Child"}</h1>
      </header>

      <RespiteChildRecord
        passportId={passportId}
        institutionId={membership.institutionId}
        currentUserId={user.id}
        viewerRole="care_staff"
        onChildNameChange={setChildName}
      />
    </main>
    <CareBottomNav />
    </>
  );
}
