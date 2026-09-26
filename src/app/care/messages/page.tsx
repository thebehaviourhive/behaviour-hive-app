"use client";

import { useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionMembership } from "@/hooks/useInstitutionMembership";
import { useHandoverInbox } from "@/hooks/useHandoverInbox";
import { PendingApprovalState } from "@/components/clinic/PendingApprovalState";
import { MembershipMissingState } from "@/components/clinic/MembershipMissingState";
import { HandoverInboxSection } from "@/components/respite/HandoverInboxSection";
import { HandoverDetailSheet } from "@/components/respite/HandoverDetailSheet";
import { CareBottomNav } from "@/components/respite/CareBottomNav";
import { CentrePageContent } from "@/components/respite/CentrePageContent";
import type { HandoverMessage } from "@/hooks/useHandoverInbox";

// Respite UI Stage 2b -- care_staff's own side of the same inbox.
// Care staff are the primary audience -- they're the ones coming on
// shift wanting to see what was left for them. Identical scoping and
// identical read gate to the centre_manager screen (see that page's
// own header) -- both roles read handover the same narrower,
// activation-scoped way, per the live can_view_message() policy.
export default function CareMessagesPage() {
  const { user, isReady } = useRequireRole("care_staff");
  const membership = useInstitutionMembership(user?.id, "care_staff");
  const inbox = useHandoverInbox(membership.institutionId);
  const [openMessage, setOpenMessage] = useState<HandoverMessage | null>(null);

  if (!isReady || membership.status === "checking") {
    return null;
  }
  if (membership.status === "pending") {
    return <PendingApprovalState waitingFor="centre manager" />;
  }
  if (membership.status === "missing") {
    return <MembershipMissingState noun="centre" />;
  }

  return (
    <>
      <main className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 px-4 py-6 pb-24 lg:pb-6">
        <CentrePageContent>
          <h1 className="mb-1 font-heading text-2xl font-semibold text-brand-neutral-black">Messages</h1>
          <p className="mb-4 text-sm text-black/60">Handovers for children currently activated for you.</p>
          <HandoverInboxSection
            groups={inbox.groups}
            isLoading={inbox.isLoading}
            loadError={inbox.loadError}
            onRetry={inbox.refresh}
            onOpenMessage={(m) => {
              setOpenMessage(m);
              if (!m.isRead) inbox.markRead(m.messageId);
            }}
          />
        </CentrePageContent>
      </main>

      <CareBottomNav />

      <HandoverDetailSheet
        message={openMessage}
        recordHref={(passportId) => `/care/passport/${passportId}`}
        onClose={() => setOpenMessage(null)}
      />
    </>
  );
}
