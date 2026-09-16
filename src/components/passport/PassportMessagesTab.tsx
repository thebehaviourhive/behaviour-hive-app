"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useMessageThread } from "@/hooks/useMessageThread";
import { useMessageCategories } from "@/hooks/useMessageCategories";
import { fetchApprovedInstitutionPhone } from "@/lib/messages/institutionPhone";
import { MessageList } from "@/components/messages/MessageList";
import { ComposeMessageSheet } from "@/components/messages/ComposeMessageSheet";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import type { MessageRole } from "@/types/messages";

// A child's own Messages tab -- "a small entry consistent with that
// page's structure" (Stage 2 brief): same tab pattern every other
// Clinical/Classroom File tab already uses, self-contained, no child
// picker needed since passportId is already fixed by the route.
// Compose here is pre-selected to this one child, unlike the triage
// view's own [New] which has to ask first.
//
// Originally teacher-only (TeacherPassportMessagesTab); parameterized
// with senderRole once a principal needed the identical tab (Stage 4,
// item 1) -- can_view_message()/get_message_recipient_candidates()/
// send_message() already had a principal branch (0161/0168), and
// MessageRole already included "principal" end to end, so the only
// thing hardcoding this to one role was this component's own two
// "class_teacher" literals below.
export function PassportMessagesTab({
  passportId,
  childName,
  userId,
  senderRole,
}: {
  passportId: string;
  childName: string;
  userId: string;
  senderRole: MessageRole;
}) {
  const { messages, candidates, nameById, isLoading, loadError, refresh } = useMessageThread(passportId);
  const { categories } = useMessageCategories(senderRole);
  const [institutionPhone, setInstitutionPhone] = useState<string | null>(null);
  const [isComposeOpen, setIsComposeOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      const supabase = createClient();
      const phone = await fetchApprovedInstitutionPhone(supabase, passportId);
      if (isMounted) setInstitutionPhone(phone);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [passportId]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsComposeOpen(true)}
        className="mb-3 flex items-center gap-1.5 rounded-full bg-brand-prussian-blue py-2 pl-3 pr-3.5 text-sm font-semibold text-white"
      >
        <Plus size={16} strokeWidth={2.5} aria-hidden />
        New message
      </button>

      {loadError ? (
        <InlineErrorState message={loadError} onRetry={() => refresh()} />
      ) : (
        <MessageList
          messages={messages}
          currentUserId={userId}
          nameById={nameById}
          isLoading={isLoading}
          onChanged={refresh}
          childName={childName}
          viewerRole={senderRole}
        />
      )}

      <ComposeMessageSheet
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        passportId={passportId}
        childName={childName}
        candidates={candidates}
        categories={categories}
        institutionPhone={institutionPhone}
        onSent={refresh}
      />
    </div>
  );
}
