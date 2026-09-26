"use client";

import { useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionMembership } from "@/hooks/useInstitutionMembership";
import { useHandoverInbox } from "@/hooks/useHandoverInbox";
import { PendingApprovalState } from "@/components/clinic/PendingApprovalState";
import { MembershipMissingState } from "@/components/clinic/MembershipMissingState";
import { HandoverInboxSection } from "@/components/respite/HandoverInboxSection";
import { HandoverDetailSheet } from "@/components/respite/HandoverDetailSheet";
import { CentreBottomNav } from "@/components/respite/CentreBottomNav";
import { CentrePageContent } from "@/components/respite/CentrePageContent";
import type { HandoverMessage } from "@/hooks/useHandoverInbox";

// Respite UI Stage 2b -- the centre_manager side of the handover inbox.
// Handover was a headline PRD 11 feature with no route to it anywhere
// -- the only way to reach one was remembering which child it concerned
// and opening that child's own record. get_my_handover_messages()
// (migration 0311) restates the real read gate directly: activation-
// scoped for BOTH roles, identically -- a manager's own usually-wider
// placement-scoped reach does NOT apply here, so this list can only
// ever show handovers for children currently on-site, never a full
// history. That's not a limitation of this screen; it's what the
// underlying read policy has always meant.
export default function CentreMessagesPage() {
  const { user, isReady } = useRequireRole("centre_manager");
  const membership = useInstitutionMembership(user?.id, "centre_manager");
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
          <p className="mb-4 text-sm text-black/60">Handovers for children currently on-site.</p>
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

      <CentreBottomNav />

      <HandoverDetailSheet
        message={openMessage}
        recordHref={(passportId) => `/centre/passport/${passportId}`}
        onClose={() => setOpenMessage(null)}
      />
    </>
  );
}
