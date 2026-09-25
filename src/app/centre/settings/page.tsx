"use client";

import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionMembership } from "@/hooks/useInstitutionMembership";
import { createClient } from "@/lib/supabase/client";
import { SetDefaultSnoozeDaysSheet } from "@/components/principal/SetDefaultSnoozeDaysSheet";
import { PendingApprovalState } from "@/components/clinic/PendingApprovalState";
import { MembershipMissingState } from "@/components/clinic/MembershipMissingState";
import { CentreBottomNav } from "@/components/respite/CentreBottomNav";
import { CentrePageContent } from "@/components/respite/CentrePageContent";

// Outstanding-task snoozing, 25 Sept 2026 -- the centre's own first
// settings screen, named directly in the brief ("the Centre screen
// when it exists" -- it didn't). A single setting for now, matching
// School's own "Routine Controls" and Clinic's own booking-settings
// section in shape (a plain settings row, "Change" opens a sheet), not
// a whole new visual pattern invented for one field. More settings can
// join this page later; this is its real home now rather than folding
// a settings concept into /centre/dashboard or /centre/staff, neither
// of which is about configuration.
export default function CentreSettingsPage() {
  const { user, isReady } = useRequireRole("centre_manager");
  const membership = useInstitutionMembership(user?.id, "centre_manager");
  const institutionId = membership.institutionId;
  const institutionName = membership.institutionName;

  const [defaultSnoozeDays, setDefaultSnoozeDays] = useState(5);
  const [isSnoozeDaysOpen, setIsSnoozeDaysOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!institutionId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("institutions")
      .select("default_snooze_days")
      .eq("id", institutionId)
      .maybeSingle();
    if (data?.default_snooze_days) {
      setDefaultSnoozeDays(data.default_snooze_days);
    }
    setIsLoading(false);
  }, [institutionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!isReady || membership.status === "checking" || isLoading) {
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
          <h1 className="mb-1 font-heading text-2xl font-semibold text-brand-neutral-black">Settings</h1>
          {institutionName && <p className="mb-4 text-sm text-black/60">{institutionName}</p>}

          <section>
            <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
              Outstanding Work
            </h2>
            <div className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
              <div>
                <p className="font-sans text-body font-semibold text-brand-neutral-black">Default snooze length</p>
                <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/50">
                  An outstanding task snoozed with no day count picked stays hidden for {defaultSnoozeDays} day
                  {defaultSnoozeDays === 1 ? "" : "s"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSnoozeDaysOpen(true)}
                className="flex-shrink-0 font-sans text-body font-semibold text-brand-prussian-blue"
              >
                Change
              </button>
            </div>
          </section>
        </CentrePageContent>
      </main>

      <CentreBottomNav />

      {institutionId && (
        <SetDefaultSnoozeDaysSheet
          isOpen={isSnoozeDaysOpen}
          institutionId={institutionId}
          currentDays={defaultSnoozeDays}
          onClose={() => setIsSnoozeDaysOpen(false)}
          onSaved={(newDays) => {
            setDefaultSnoozeDays(newDays);
            setIsSnoozeDaysOpen(false);
          }}
        />
      )}
    </>
  );
}
