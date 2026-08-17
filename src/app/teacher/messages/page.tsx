"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTeacherPassports } from "@/hooks/useTeacherPassports";
import { useMessageThread } from "@/hooks/useMessageThread";
import { useMessageCategories } from "@/hooks/useMessageCategories";
import { TeacherBottomNav } from "@/components/teacher/TeacherBottomNav";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { MessageList } from "@/components/messages/MessageList";
import { ComposeMessageSheet } from "@/components/messages/ComposeMessageSheet";

// Teacher's Messages home -- Stage 1: minimal but real, enough to prove
// the full parent<->teacher loop end-to-end (send/acknowledge/reply/
// close, live). A proper roster-integrated surface is Stage 2; this is
// a plain child picker in front of the same shared list/card/compose
// components the parent track uses -- no separate implementation.
export default function TeacherMessagesPage() {
  const { user, isReady: isRoleReady } = useRequireRole("class_teacher");
  const { isLoading: isLoadingPassports, institutionId, passports, error } = useTeacherPassports(
    user?.id ?? null
  );
  const [selectedPassportId, setSelectedPassportId] = useState<string | null>(null);
  const [institutionPhone, setInstitutionPhone] = useState<string | null>(null);
  const [isComposeOpen, setIsComposeOpen] = useState(false);

  useEffect(() => {
    if (!institutionId) return;
    let isMounted = true;
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("institutions")
        .select("phone")
        .eq("id", institutionId)
        .maybeSingle();
      if (isMounted) setInstitutionPhone(data?.phone ?? null);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [institutionId]);

  const selectedPassport = passports.find((p) => p.passportId === selectedPassportId) ?? null;

  const { messages, candidates, nameById, isLoading, loadError, refresh } = useMessageThread(
    selectedPassportId
  );
  const { categories } = useMessageCategories("class_teacher");

  if (!isRoleReady || isLoadingPassports) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center justify-between gap-3 px-4 pt-6 pb-2">
        <div className="flex items-center gap-3">
          {selectedPassport && (
            <button
              type="button"
              aria-label="Back to students"
              onClick={() => setSelectedPassportId(null)}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
            >
              ‹
            </button>
          )}
          <h1 className="font-heading text-2xl font-semibold text-brand-prussian-blue">
            {selectedPassport ? selectedPassport.displayName : "Messages"}
          </h1>
        </div>
        {selectedPassport && (
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
        {error ? (
          <InlineErrorState message="Couldn't load your students." onRetry={() => window.location.reload()} />
        ) : !selectedPassport ? (
          passports.length === 0 ? (
            <p className="py-12 text-center text-sm text-brand-neutral-black/50">
              No students linked yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {passports.map((passport) => (
                <button
                  key={passport.passportId}
                  type="button"
                  onClick={() => setSelectedPassportId(passport.passportId)}
                  className="flex items-center justify-between rounded-2xl border border-black/5 bg-white px-4 py-3.5 text-left shadow-sm"
                >
                  <span className="text-sm font-semibold text-brand-neutral-black">
                    {passport.displayName}
                  </span>
                  <span className="text-lg text-brand-neutral-black/30">›</span>
                </button>
              ))}
            </div>
          )
        ) : loadError ? (
          <InlineErrorState message={loadError} onRetry={() => refresh()} />
        ) : user ? (
          <MessageList
            messages={messages}
            currentUserId={user.id}
            nameById={nameById}
            isLoading={isLoading}
            onChanged={refresh}
          />
        ) : null}
      </main>

      {selectedPassport && user && (
        <ComposeMessageSheet
          isOpen={isComposeOpen}
          onClose={() => setIsComposeOpen(false)}
          passportId={selectedPassport.passportId}
          childName={selectedPassport.displayName}
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
