"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTeacherPassports } from "@/hooks/useTeacherPassports";
import { useMessageTriage } from "@/hooks/useMessageTriage";
import { useMessageThread } from "@/hooks/useMessageThread";
import { useMessageCategories } from "@/hooks/useMessageCategories";
import { TeacherBottomNav } from "@/components/teacher/TeacherBottomNav";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { MessageTriage } from "@/components/messages/MessageTriage";
import { ComposeMessageSheet } from "@/components/messages/ComposeMessageSheet";
import { BottomSheet } from "@/components/ui/BottomSheet";

// Teacher's Messages home -- Stage 2: the triage view. Open messages
// across every linked pupil in one list, grouped by child, one tap to
// acknowledge each with no navigation away. Composing still needs a
// specific child first (a message can only ever be about one passport),
// so [New] opens a plain child picker, then the same shared compose
// sheet every track uses.
export default function TeacherMessagesPage() {
  const { user, isReady: isRoleReady } = useRequireRole("class_teacher");
  const { isLoading: isLoadingPassports, institutionId, passports, error } = useTeacherPassports(
    user?.id ?? null
  );
  const { groups, nameById, isLoading, loadError, refresh } = useMessageTriage(passports);

  const [institutionPhone, setInstitutionPhone] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [composePassportId, setComposePassportId] = useState<string | null>(null);

  useEffect(() => {
    if (!institutionId) return;
    let isMounted = true;
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from("institutions").select("phone").eq("id", institutionId).maybeSingle();
      if (isMounted) setInstitutionPhone(data?.phone ?? null);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [institutionId]);

  const composePassport = passports.find((p) => p.passportId === composePassportId) ?? null;
  const { candidates } = useMessageThread(composePassport ? composePassportId : null);
  const { categories } = useMessageCategories("class_teacher");

  if (!isRoleReady || isLoadingPassports) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center justify-between gap-3 px-4 pt-6 pb-2">
        <h1 className="font-heading text-2xl font-semibold text-brand-prussian-blue">Messages</h1>
        {passports.length > 0 && (
          <button
            type="button"
            onClick={() => setIsPickerOpen(true)}
            className="flex items-center gap-1.5 rounded-full bg-brand-prussian-blue py-2 pl-3 pr-3.5 text-sm font-semibold text-white"
          >
            <Plus size={16} strokeWidth={2.5} aria-hidden />
            New
          </button>
        )}
      </header>

      <main className="flex-1 px-4 py-2">
        {error ? (
          <InlineErrorState message="Couldn't load your students." onRetry={() => window.location.reload()} />
        ) : passports.length === 0 ? (
          <p className="py-12 text-center text-sm text-brand-neutral-black/50">No students linked yet.</p>
        ) : loadError ? (
          <InlineErrorState message={loadError} onRetry={() => refresh()} />
        ) : user ? (
          <MessageTriage
            groups={groups}
            currentUserId={user.id}
            nameById={nameById}
            isLoading={isLoading}
            onChanged={refresh}
            viewerRole="class_teacher"
          />
        ) : null}
      </main>

      {/* Plain child picker -- composing needs exactly one passport, so
          [New] resolves that first, then hands off to the shared sheet. */}
      <BottomSheet isOpen={isPickerOpen} onClose={() => setIsPickerOpen(false)}>
        <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Message which student?</h2>
        <div className="mt-4 flex flex-col gap-2">
          {passports.map((passport) => (
            <button
              key={passport.passportId}
              type="button"
              onClick={() => {
                setComposePassportId(passport.passportId);
                setIsPickerOpen(false);
              }}
              className="flex items-center justify-between rounded-2xl border border-black/5 bg-white px-4 py-3.5 text-left shadow-sm"
            >
              <span className="text-sm font-semibold text-brand-neutral-black">{passport.displayName}</span>
              <span className="text-lg text-brand-neutral-black/30">›</span>
            </button>
          ))}
        </div>
      </BottomSheet>

      {composePassport && user && (
        <ComposeMessageSheet
          isOpen={Boolean(composePassportId)}
          onClose={() => setComposePassportId(null)}
          passportId={composePassport.passportId}
          childName={composePassport.displayName}
          candidates={candidates}
          categories={categories}
          institutionPhone={institutionPhone}
          onSent={refresh}
        />
      )}

      <TeacherBottomNav />
    </div>
  );
}
