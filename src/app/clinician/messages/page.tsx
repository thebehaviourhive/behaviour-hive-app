"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useClinicianPassports } from "@/hooks/useClinicianPassports";
import { useMessageTriage } from "@/hooks/useMessageTriage";
import { useMessageThread } from "@/hooks/useMessageThread";
import { useMessageCategories } from "@/hooks/useMessageCategories";
import { createClient } from "@/lib/supabase/client";
import { fetchApprovedInstitutionPhone } from "@/lib/messages/institutionPhone";
import { ClinicianBottomNav } from "@/components/clinician/ClinicianBottomNav";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { MessageTriage } from "@/components/messages/MessageTriage";
import { ComposeMessageSheet } from "@/components/messages/ComposeMessageSheet";
import { BottomSheet } from "@/components/ui/BottomSheet";

// Clinician's Messages home -- the cross-caseload layer above the
// per-case Clinical File tab. Same triage model as the teacher track
// (grouped by child, oldest-first, one tap to acknowledge), but with two
// differences that flow straight from the role: full child names (no
// redaction -- clinicians see full names everywhere else in the app),
// and groups that can contain "Viewing only" rows alongside the
// clinician's own traffic -- their read-only parent<->teacher stream for
// that case, rendered by MessageCard exactly as it already is on the
// Clinical File tab, just aggregated here across every case at once.
export default function ClinicianMessagesPage() {
  const { user, isReady: isRoleReady } = useRequireRole("clinician");
  const { isLoading: isLoadingPassports, passports, error } = useClinicianPassports(user?.id ?? null);
  const { groups, nameById, isLoading, loadError, refresh } = useMessageTriage(passports);

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [composePassportId, setComposePassportId] = useState<string | null>(null);
  const [institutionPhone, setInstitutionPhone] = useState<string | null>(null);

  const composePassport = passports.find((p) => p.passportId === composePassportId) ?? null;
  const { candidates } = useMessageThread(composePassport ? composePassportId : null);
  const { categories } = useMessageCategories("clinician");

  useEffect(() => {
    if (!composePassportId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInstitutionPhone(null);
      return;
    }
    let isMounted = true;
    async function load() {
      const supabase = createClient();
      const phone = await fetchApprovedInstitutionPhone(supabase, composePassportId as string);
      if (isMounted) setInstitutionPhone(phone);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [composePassportId]);

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
          <InlineErrorState message="Couldn't load your caseload." onRetry={() => window.location.reload()} />
        ) : passports.length === 0 ? (
          <p className="py-12 text-center text-sm text-brand-neutral-black/50">No cases linked yet.</p>
        ) : loadError ? (
          <InlineErrorState message={loadError} onRetry={() => refresh()} />
        ) : user ? (
          <MessageTriage
            groups={groups}
            currentUserId={user.id}
            nameById={nameById}
            isLoading={isLoading}
            onChanged={refresh}
            viewerRole="clinician"
          />
        ) : null}
      </main>

      {/* Plain child picker -- composing needs exactly one passport, so
          [New] resolves that first, then hands off to the shared sheet. */}
      <BottomSheet isOpen={isPickerOpen} onClose={() => setIsPickerOpen(false)}>
        <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Message about which case?</h2>
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

      <ClinicianBottomNav />
    </div>
  );
}
