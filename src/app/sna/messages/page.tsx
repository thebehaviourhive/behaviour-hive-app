"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useStaffMessageThread } from "@/hooks/useStaffMessageThread";
import { useMessageCategories } from "@/hooks/useMessageCategories";
import { SnaBottomNav } from "@/components/sna/SnaBottomNav";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { StaffMessageList } from "@/components/messages/StaffMessageList";
import { ComposeMessageSheet } from "@/components/messages/ComposeMessageSheet";

// Migration 0168 -- SNA's first Messages surface, ever (previously
// fully excluded, see SnaBottomNav.tsx's own comment). STAFF-ONLY,
// deliberately: SNA-on-CHILD-threads is a separate, deferred piece, so
// unlike teacher/principal's own Messages pages there is no
// ComposeKindPickerSheet here -- [New] goes straight to the staff
// compose sheet, since staff is the only kind of message an SNA can
// send in this build.
export default function SnaMessagesPage() {
  const { user, isReady: isRoleReady } = useRequireRole("sna");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [isLoadingInstitution, setIsLoadingInstitution] = useState(true);
  const [institutionError, setInstitutionError] = useState<string | null>(null);

  const loadInstitution = useCallback(async () => {
    if (!user) return;
    setIsLoadingInstitution(true);
    setInstitutionError(null);
    const supabase = createClient();
    const { data: staffRow, error: staffError } = await supabase
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", user.id)
      .eq("role", "sna")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (staffError || !staffRow) {
      setInstitutionError("Could not find your school.");
      setIsLoadingInstitution(false);
      return;
    }
    setInstitutionId(staffRow.institution_id);
    setIsLoadingInstitution(false);
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadInstitution();
  }, [loadInstitution]);

  const {
    messages,
    candidates,
    nameById,
    isLoading,
    loadError,
    refresh,
  } = useStaffMessageThread(institutionId);
  const { categories } = useMessageCategories("sna", "staff");

  const [isComposeOpen, setIsComposeOpen] = useState(false);

  if (!isRoleReady || isLoadingInstitution) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center justify-between gap-3 px-4 pt-6 pb-2">
        <h1 className="font-heading text-2xl font-semibold text-brand-prussian-blue">Messages</h1>
        {institutionId && (
          <button
            type="button"
            onClick={() => setIsComposeOpen(true)}
            className="flex items-center gap-1.5 rounded-full bg-brand-prussian-blue py-2 pl-3 pr-3.5 text-sm font-semibold text-white"
          >
            <Plus size={16} strokeWidth={2.5} aria-hidden />
            New
          </button>
        )}
      </header>

      <main className="flex-1 px-4 py-2">
        {institutionError ? (
          <InlineErrorState message={institutionError} onRetry={() => loadInstitution()} />
        ) : loadError ? (
          <InlineErrorState message={loadError} onRetry={() => refresh()} />
        ) : user ? (
          <StaffMessageList
            messages={messages}
            currentUserId={user.id}
            nameById={nameById}
            isLoading={isLoading}
            onChanged={refresh}
            viewerRole="sna"
          />
        ) : null}
      </main>

      {institutionId && user && (
        <ComposeMessageSheet
          isOpen={isComposeOpen}
          onClose={() => setIsComposeOpen(false)}
          institutionId={institutionId}
          candidates={candidates}
          categories={categories}
          institutionPhone={null}
          onSent={refresh}
        />
      )}

      <SnaBottomNav />
    </div>
  );
}
