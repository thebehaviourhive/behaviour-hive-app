"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useTeacherPassports } from "@/hooks/useTeacherPassports";
import { useMessageTriage } from "@/hooks/useMessageTriage";
import { useMessageThread } from "@/hooks/useMessageThread";
import { useStaffMessageThread } from "@/hooks/useStaffMessageThread";
import { useMessageCategories } from "@/hooks/useMessageCategories";
import { TeacherBottomNav } from "@/components/teacher/TeacherBottomNav";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { MessageTriage } from "@/components/messages/MessageTriage";
import { StaffMessageList } from "@/components/messages/StaffMessageList";
import { ComposeMessageSheet } from "@/components/messages/ComposeMessageSheet";
import { ComposeKindPickerSheet } from "@/components/messages/ComposeKindPickerSheet";
import { MessageChildPickerSheet } from "@/components/messages/MessageChildPickerSheet";

// Teacher's Messages home -- Stage 2: the triage view. Open messages
// across every linked pupil in one list, grouped by child, one tap to
// acknowledge each with no navigation away. Composing still needs a
// specific child first (a message can only ever be about one passport),
// so [New] opens a plain child picker, then the same shared compose
// sheet every track uses.
//
// Migration 0168 -- staff-to-staff messaging, small version. [New] now
// opens a first-level choice (ComposeKindPickerSheet, Daniel's own
// spec, verbatim): "about a student" keeps the exact flow above, "staff"
// skips straight to the compose sheet in staff mode (no second picker --
// recipients are chosen as chips inside that sheet, same as it already
// works for a child thread). A "Staff" section renders below the
// per-child triage, flat and ungrouped (useStaffMessageThread/
// StaffMessageList) -- the small version's own scope decision, not a
// second triage screen. [New] is no longer gated on passports.length >
// 0 -- a teacher with zero linked children can still message staff.
export default function TeacherMessagesPage() {
  const { user, isReady: isRoleReady } = useRequireRole("class_teacher");
  const { isLoading: isLoadingPassports, institutionId, passports, error, refresh: refreshPassports } = useTeacherPassports(
    user?.id ?? null
  );
  const { groups, nameById, isLoading, loadError, refresh } = useMessageTriage(passports);
  const {
    messages: staffMessages,
    nameById: staffNameById,
    candidates: staffCandidates,
    isLoading: isLoadingStaff,
    loadError: staffLoadError,
    refresh: refreshStaff,
  } = useStaffMessageThread(institutionId);

  const [institutionPhone, setInstitutionPhone] = useState<string | null>(null);
  const [pickerStep, setPickerStep] = useState<"closed" | "kind" | "student">("closed");
  const [composePassportId, setComposePassportId] = useState<string | null>(null);
  const [isStaffComposeOpen, setIsStaffComposeOpen] = useState(false);

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
  const { categories: staffCategories } = useMessageCategories("class_teacher", "staff");

  if (!isRoleReady || isLoadingPassports) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center justify-between gap-3 px-4 pt-6 pb-2">
        <h1 className="font-heading text-2xl font-semibold text-brand-prussian-blue">Messages</h1>
        {institutionId && (
          <button
            type="button"
            onClick={() => setPickerStep("kind")}
            className="flex items-center gap-1.5 rounded-full bg-brand-prussian-blue py-2 pl-3 pr-3.5 text-sm font-semibold text-white"
          >
            <Plus size={16} strokeWidth={2.5} aria-hidden />
            New
          </button>
        )}
      </header>

      <main className="flex-1 px-4 py-2">
        {error ? (
          <InlineErrorState message="Couldn't load your students." onRetry={() => refreshPassports()} />
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

        {institutionId && (
          <section className="mt-6">
            <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
              Staff
            </h2>
            {staffLoadError ? (
              <InlineErrorState message={staffLoadError} onRetry={() => refreshStaff()} />
            ) : user ? (
              <StaffMessageList
                messages={staffMessages}
                currentUserId={user.id}
                nameById={staffNameById}
                isLoading={isLoadingStaff}
                onChanged={refreshStaff}
                viewerRole="class_teacher"
              />
            ) : null}
          </section>
        )}
      </main>

      <ComposeKindPickerSheet
        isOpen={pickerStep === "kind"}
        onClose={() => setPickerStep("closed")}
        studentLabel="student"
        onChooseStudent={() => setPickerStep("student")}
        onChooseStaff={() => {
          setPickerStep("closed");
          setIsStaffComposeOpen(true);
        }}
      />

      {/* Plain child picker -- composing needs exactly one passport, so
          this resolves that first, then hands off to the shared sheet.
          Alphabetical, and search+collapse above 7 -- see that
          component's own header for why this replaced a bare
          passports.map(). */}
      <MessageChildPickerSheet
        isOpen={pickerStep === "student"}
        onClose={() => setPickerStep("closed")}
        title="Message about which student?"
        candidates={passports}
        emptyMessage="No students linked yet."
        onSelect={(passportId) => {
          setComposePassportId(passportId);
          setPickerStep("closed");
        }}
      />

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

      {institutionId && user && (
        <ComposeMessageSheet
          isOpen={isStaffComposeOpen}
          onClose={() => setIsStaffComposeOpen(false)}
          institutionId={institutionId}
          candidates={staffCandidates}
          categories={staffCategories}
          institutionPhone={institutionPhone}
          onSent={refreshStaff}
        />
      )}

      <TeacherBottomNav />
    </div>
  );
}
