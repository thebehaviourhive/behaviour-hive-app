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

// The Clinical File's Messages tab -- the per-case mid-day signal.
// Chronological, category-chipped, no charts (that's future ticket->
// data bridging, not Stage 2). useMessageThread + can_view_message
// already return exactly the right set: this clinician's own sent/
// received traffic AND the read-only parent<->teacher stream for this
// case -- MessageCard marks the latter "Viewing only" and renders no
// acknowledge/reply affordance on it, since the clinician genuinely
// isn't a participant on those rows (server-enforced, not just hidden
// here -- see acknowledge_message/reply_to_message's own participant
// checks).
export function ClinicalFileMessagesTab({
  passportId,
  childName,
  userId,
}: {
  passportId: string;
  childName: string;
  userId: string;
}) {
  const { messages, candidates, nameById, isLoading, loadError, refresh } = useMessageThread(passportId);
  const { categories } = useMessageCategories("clinician");
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
          emptyOpenMessage="No open messages for this case."
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
