"use client";

import { useParams } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionMembership } from "@/hooks/useInstitutionMembership";
import { RespiteChildRecord } from "@/components/respite/RespiteChildRecord";

// PRD 11 Stage 5, item 4 -- the first-five-minutes screen, care_staff's
// own route. Activation-scoped read throughout -- see migration 0302
// and the shared RespiteChildRecord component for the full shape.
export default function CareStaffPassportPage() {
  const params = useParams<{ passportId: string }>();
  const passportId = params.passportId;
  const { user, isReady } = useRequireRole("care_staff");
  const membership = useInstitutionMembership(user?.id, "care_staff");

  if (!isReady || membership.status !== "approved" || !user || !membership.institutionId) {
    return null;
  }

  return (
    <main className="min-h-full bg-brand-off-white/40 px-4 py-4">
      <RespiteChildRecord
        passportId={passportId}
        institutionId={membership.institutionId}
        currentUserId={user.id}
        viewerRole="care_staff"
      />
    </main>
  );
}
