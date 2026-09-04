"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useMessageTriage } from "@/hooks/useMessageTriage";
import { useMessageThread } from "@/hooks/useMessageThread";
import { useStaffMessageThread } from "@/hooks/useStaffMessageThread";
import { useMessageCategories } from "@/hooks/useMessageCategories";
import { PrincipalBottomNav } from "@/components/principal/PrincipalBottomNav";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { MessageTriage } from "@/components/messages/MessageTriage";
import { StaffMessageList } from "@/components/messages/StaffMessageList";
import { ComposeMessageSheet } from "@/components/messages/ComposeMessageSheet";
import { ComposeKindPickerSheet } from "@/components/messages/ComposeKindPickerSheet";
import { BottomSheet } from "@/components/ui/BottomSheet";

// Migration 0161. "Threads they are addressed on, nothing else" governs
// READING here -- there is deliberately no institution-wide "every
// conversation at my school" view. useMessageTriage(passports) is fed
// the FULL institution roster (get_institution_child_roster()), not a
// "my linked children" list the way teacher/clinician's own pages use
// it -- a principal has no such list, they're addressed ad hoc. That's
// safe: the .in("passport_id", ids) query underneath is still filtered
// row-by-row by can_view_message()'s own new principal branch
// (sender-or-recipient, never a bare institution-membership check), so
// passing every enrolled child here doesn't widen what's actually
// returned -- children with no thread the principal is a party to
// simply produce zero rows and never appear as a group.
//
// Composing: a principal CAN start a thread now (Daniel's own
// correction -- "threads they are addressed on" was a reading rule,
// not a sending one), scoped server-side to children enrolled at their
// own institution (send_message()'s new principal branch). The picker
// below is the same roster, not a "my children" list, since a
// principal's own reason to write isn't bounded by an existing
// relationship the way a class teacher's or clinician's is.
//
// Migration 0168 -- staff-to-staff, same shape teacher/messages just
// got: ComposeKindPickerSheet above the child picker, a flat "Staff"
// section below the roster triage. Institution-wide reach here is
// genuinely the same predicate every child-thread principal branch
// already uses (institution_staff_has_current_standing), not a
// widening specific to this section.
export default function PrincipalMessagesPage() {
  const { user, isReady: isRoleReady } = useRequireRole("principal");
  const [passports, setPassports] = useState<{ passportId: string; displayName: string }[]>([]);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [isLoadingRoster, setIsLoadingRoster] = useState(true);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const loadRoster = useCallback(async () => {
    if (!user) return;
    setIsLoadingRoster(true);
    setRosterError(null);
    const supabase = createClient();

    const { data: staffRow, error: staffError } = await supabase
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", user.id)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (staffError || !staffRow) {
      setRosterError("Could not find your institution.");
      setIsLoadingRoster(false);
      return;
    }
    setInstitutionId(staffRow.institution_id);

    const { data: rosterRows, error: rosterErr } = await supabase.rpc("get_institution_child_roster", {
      p_institution_id: staffRow.institution_id,
    });
    if (rosterErr) {
      setRosterError("Could not load your school's roster.");
      setIsLoadingRoster(false);
      return;
    }
    setPassports(
      ((rosterRows ?? []) as { passport_id: string; child_name: string }[]).map((r) => ({
        passportId: r.passport_id,
        displayName: r.child_name,
      }))
    );
    setIsLoadingRoster(false);
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRoster();
  }, [loadRoster]);

  const { groups, nameById, isLoading, loadError, refresh } = useMessageTriage(passports);
  const {
    messages: staffMessages,
    nameById: staffNameById,
    candidates: staffCandidates,
    isLoading: isLoadingStaff,
    loadError: staffLoadError,
    refresh: refreshStaff,
  } = useStaffMessageThread(institutionId);

  const [pickerStep, setPickerStep] = useState<"closed" | "kind" | "student">("closed");
  const [composePassportId, setComposePassportId] = useState<string | null>(null);
  const [isStaffComposeOpen, setIsStaffComposeOpen] = useState(false);

  const composePassport = passports.find((p) => p.passportId === composePassportId) ?? null;
  const { candidates } = useMessageThread(composePassport ? composePassportId : null);
  const { categories } = useMessageCategories("principal");
  const { categories: staffCategories } = useMessageCategories("principal", "staff");

  if (!isRoleReady || isLoadingRoster) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24 lg:pb-10">
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
        {rosterError ? (
          <InlineErrorState message={rosterError} onRetry={() => loadRoster()} />
        ) : passports.length === 0 ? (
          <p className="py-12 text-center text-sm text-brand-neutral-black/50">No children enrolled yet.</p>
        ) : loadError ? (
          <InlineErrorState message={loadError} onRetry={() => refresh()} />
        ) : user ? (
          <MessageTriage
            groups={groups}
            currentUserId={user.id}
            nameById={nameById}
            isLoading={isLoading}
            onChanged={refresh}
            viewerRole="principal"
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
                viewerRole="principal"
              />
            ) : null}
          </section>
        )}
      </main>

      <ComposeKindPickerSheet
        isOpen={pickerStep === "kind"}
        onClose={() => setPickerStep("closed")}
        studentLabel="child"
        onChooseStudent={() => setPickerStep("student")}
        onChooseStaff={() => {
          setPickerStep("closed");
          setIsStaffComposeOpen(true);
        }}
      />

      {/* Same plain-picker-then-shared-sheet pattern every other track
          uses -- composing needs exactly one passport first. The roster
          here, not a "linked children" list -- a principal's own reason
          to write isn't bounded by an existing relationship. */}
      <BottomSheet isOpen={pickerStep === "student"} onClose={() => setPickerStep("closed")}>
        <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Message about which child?</h2>
        <div className="mt-4 flex max-h-96 flex-col gap-2 overflow-y-auto">
          {passports
            .slice()
            .sort((a, b) => a.displayName.localeCompare(b.displayName))
            .map((passport) => (
              <button
                key={passport.passportId}
                type="button"
                onClick={() => {
                  setComposePassportId(passport.passportId);
                  setPickerStep("closed");
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
          institutionPhone={null}
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
          institutionPhone={null}
          onSent={refreshStaff}
        />
      )}

      <PrincipalBottomNav />
    </div>
  );
}
