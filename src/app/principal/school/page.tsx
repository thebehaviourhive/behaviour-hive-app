"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRedirect } from "@/lib/roleRedirect";
import { PrincipalBottomNav } from "@/components/principal/PrincipalBottomNav";
import { HandOverPrincipalSheet } from "@/components/principal/HandOverPrincipalSheet";
import { SetCutoffSheet } from "@/components/principal/SetCutoffSheet";
import { SetStartTimeSheet } from "@/components/principal/SetStartTimeSheet";
import { IncidentLocationsCard } from "@/components/principal/IncidentLocationsCard";
import { formatTimeOfDay } from "@/lib/temporaryAccessTime";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";

// PRD 2, Stage 1. New top-level tab -- "School" owns settings and
// account administration, per the design's own instruction: handover
// lives here, under its own heading, "findable without hunting, never
// adjacent to routine actions" -- moved off /principal/staff, where it
// previously sat alongside ordinary deactivate actions.
//
// PRD 2, Stage 6: the cut-off-time control itself moves in from
// /principal/classes -- this page's own Stage 1 comment named this
// exact move as deferred ("Temporary access[.] is where that setting
// actually belongs once this area gets its real design"), and Stage 6
// is that design. Same inline bar pattern Classes used to show it in
// (label + value + "Change"), not a new visual pattern -- just its
// real home now that Temporary Access exists as its own live-status
// surface under Directory, distinct from this settings control.
//
// PRD 2, Stage 6 follow-up (migration 0133): a second bar, start time,
// added alongside -- activation used to be a fixed 07:30 constant with
// no control anywhere; it's now a settable sibling of the cut-off, same
// pattern, same section.
//
// PRD 4, Stage 5 -- Routine Controls (Settings, renamed) becomes a
// single-column list capped at 8 columns wide at lg+, so it doesn't
// stretch edge to edge on a laptop; Incident locations joins it as a
// genuinely new control (IncidentLocationsCard -- 0068's own write
// policy, never given a client before this). Physical intervention
// vocabularies (cpi_reason_types/cpi_disengagement_types/
// cpi_result_types) do NOT join it -- parked, CLAUDE.md, pending a
// clinical decision on who may edit a school's trained intervention
// terms, not a technical gap.
//
// Handover moves to the bottom, isolated: its own eyebrow (ACCOUNT
// ADMINISTRATION, Prussian Blue), 64px clear of Routine Controls above
// it, its own card. Used perhaps twice in a school's lifetime and hands
// away every permission the person has -- findable without hunting,
// never adjacent to a routine control it could be tapped alongside by
// accident. HandOverPrincipalSheet itself is unchanged -- reskin never
// reimplement -- including its confirmation copy.

interface StaffRow {
  user_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

export default function PrincipalSchoolPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("principal");
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  // QA run-through, item 2: nowhere in the app could a principal see
  // their own institution_code -- every join flow needs it, but it was
  // only ever handed over manually by Daniel at institution creation.
  // A principal locked out of onboarding their own staff is a harder
  // stop than anything else flagged in that pass.
  const [institutionCode, setInstitutionCode] = useState<string | null>(null);
  const [isCodeCopied, setIsCodeCopied] = useState(false);
  const [startTime, setStartTime] = useState<string>("07:30:00");
  const [cutoffTime, setCutoffTime] = useState<string>("15:00:00");
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isHandOverOpen, setIsHandOverOpen] = useState(false);
  const [isStartTimeOpen, setIsStartTimeOpen] = useState(false);
  const [isCutoffOpen, setIsCutoffOpen] = useState(false);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  // Bug sweep item 3 -- the principal track had no sign-out anywhere,
  // on either PrincipalBottomNav or PrincipalSidebar, and no route
  // reaches it (the shared /more page the other four tracks use has no
  // principal branch in its own role-conditional bottom nav either).
  // Placed here, under Account Administration -- Daniel's own default:
  // account-level, same isolation Transfer Principal Role already gets,
  // not bolted onto routine School settings above it. Same confirm-
  // sheet idiom and copy as /more's own "Log out" (the other four
  // tracks' shared pattern), not a fifth one invented for this track.
  const [isLogOutOpen, setIsLogOutOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    const supabase = createClient();

    const { data: staffRow, error: staffError } = await supabase
      .from("institution_staff")
      .select(
        "institution_id, institutions(name, institution_code, temporary_access_start_time, temporary_access_cutoff_time)"
      )
      .eq("user_id", user.id)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (staffError || !staffRow) {
      setError("Could not find your institution.");
      setIsLoading(false);
      return;
    }

    const institutionRecord = staffRow.institutions as unknown as
      | {
          name: string;
          institution_code: string;
          temporary_access_start_time: string | null;
          temporary_access_cutoff_time: string | null;
        }
      | {
          name: string;
          institution_code: string;
          temporary_access_start_time: string | null;
          temporary_access_cutoff_time: string | null;
        }[]
      | null;
    const record = Array.isArray(institutionRecord) ? institutionRecord[0] : institutionRecord;
    setInstitutionName(record?.name ?? null);
    setInstitutionCode(record?.institution_code ?? null);
    setInstitutionId(staffRow.institution_id);
    if (record?.temporary_access_start_time) {
      setStartTime(record.temporary_access_start_time);
    }
    if (record?.temporary_access_cutoff_time) {
      setCutoffTime(record.temporary_access_cutoff_time);
    }

    const { data: rosterRows, error: rosterError } = await supabase.rpc("get_institution_staff_roster", {
      p_institution_id: staffRow.institution_id,
      p_include_inactive: false,
      p_include_pending: false,
    });
    if (!rosterError) {
      setStaff((rosterRows ?? []) as StaffRow[]);
    }

    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Same shape as /more's own handleLogout -- signOut(), clear both
  // storages, replace to /login (never push, so Back can't return to a
  // signed-out principal screen).
  function handleCopyCode() {
    if (!institutionCode) return;
    navigator.clipboard.writeText(institutionCode);
    setIsCodeCopied(true);
    setTimeout(() => setIsCodeCopied(false), 1500);
  }

  async function handleLogOut() {
    setIsSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.localStorage.clear();
    window.sessionStorage.clear();
    router.replace("/login");
  }

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="px-4 pt-6 pb-4">
        <h1 className="font-heading text-h1 font-bold text-brand-prussian-blue">School</h1>
        {institutionName && (
          <p className="mt-0.5 font-sans text-body text-brand-neutral-black/60">{institutionName}</p>
        )}
      </header>

      <main className="flex-1 px-4">
        <div className="lg:max-w-[66.6667%]">
          {isLoading ? (
            <div className="flex flex-col gap-2">
              <div className="h-[120px] animate-pulse rounded-2xl bg-white" />
              <div className="h-[120px] animate-pulse rounded-2xl bg-white" />
              <div className="h-[120px] animate-pulse rounded-2xl bg-white" />
            </div>
          ) : error ? (
            <p className="font-sans text-body text-brand-neutral-black/60">{error}</p>
          ) : (
            <>
              <section>
                <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
                  School Code
                </h2>
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-brand-golden-brown/40 bg-brand-safe-ivory/30 px-5 py-4">
                  {institutionCode ? (
                    <span className="font-heading text-2xl font-bold tracking-widest text-brand-neutral-black">
                      {institutionCode}
                    </span>
                  ) : (
                    <span className="font-heading text-lg text-black/40">Not available</span>
                  )}
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    disabled={!institutionCode}
                    className="flex-shrink-0 rounded-full bg-brand-golden-brown px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    {isCodeCopied ? "Copied!" : "Copy Code"}
                  </button>
                </div>
                <p className="mt-2 font-sans text-eyebrow text-brand-neutral-black/50">
                  Share this with a new class teacher, SNA, or principal so they can join {institutionName ?? "your school"}. They&apos;ll enter it at sign-up -- clinicians connect a different way, with their own code.
                </p>
              </section>

              <section className="mt-16">
                <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
                  Routine Controls
                </h2>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                    <div>
                      <p className="font-sans text-body font-semibold text-brand-neutral-black">Temporary cover start time</p>
                      <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/50">
                        Starts daily at {formatTimeOfDay(startTime)}, ends at {formatTimeOfDay(cutoffTime)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsStartTimeOpen(true)}
                      className="flex-shrink-0 font-sans text-body font-semibold text-brand-prussian-blue"
                    >
                      Change
                    </button>
                  </div>

                  <div className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                    <div>
                      <p className="font-sans text-body font-semibold text-brand-neutral-black">Temporary cover cut-off</p>
                      <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/50">
                        Starts {formatTimeOfDay(startTime)}, ends daily at {formatTimeOfDay(cutoffTime)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsCutoffOpen(true)}
                      className="flex-shrink-0 font-sans text-body font-semibold text-brand-prussian-blue"
                    >
                      Change
                    </button>
                  </div>

                  <IncidentLocationsCard institutionId={institutionId} />
                </div>
              </section>

              <section className="mt-16">
                <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
                  Account Administration
                </h2>
                <button
                  type="button"
                  onClick={() => setIsHandOverOpen(true)}
                  className="block w-full lg:w-auto rounded-2xl border border-brand-prussian-blue bg-white p-4 text-left shadow-sm"
                >
                  <p className="font-sans text-body font-semibold text-brand-prussian-blue">Transfer Principal Role</p>
                  <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/50">
                    Promotes another active staff member. This cannot be undone from your own account.
                  </p>
                </button>

                {/* Desktop-layout audit, 16 Sept 2026: this row's own
                    lg:w-auto was missing outright until this pass --
                    measured live at 661px (52% of a 1280px viewport),
                    notably wider than "Log out" right below it. The
                    comment that used to sit here justified that gap as
                    deliberate ("this one just has nothing to fill it")
                    -- that reasoning was never re-checked after being
                    written, and was simply wrong: a stretched button
                    reads as unfinished regardless of what it contains.
                    Fixed by giving it the same lg:w-auto "Log out" was
                    already correctly using. */}
                <button
                  type="button"
                  onClick={() => setIsLogOutOpen(true)}
                  className="mt-2 block w-full lg:w-auto rounded-2xl border border-black/5 bg-white px-6 py-4 text-left shadow-sm"
                >
                  <p className="font-sans text-body font-semibold text-brand-neutral-black">Log out</p>
                </button>
              </section>
            </>
          )}
        </div>
      </main>

      <BottomSheet isOpen={isLogOutOpen} onClose={() => !isSigningOut && setIsLogOutOpen(false)}>
        <h2 className="font-heading text-lg font-semibold text-brand-neutral-black">
          Are you sure you want to log out?
        </h2>

        <div className="mt-5 flex gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setIsLogOutOpen(false)}
            disabled={isSigningOut}
            className="flex-1"
          >
            Cancel
          </Button>
          <button
            type="button"
            onClick={handleLogOut}
            disabled={isSigningOut}
            className="flex-1 rounded-2xl bg-red-600 px-5 py-3.5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSigningOut ? "Logging out…" : "Log out"}
          </button>
        </div>
      </BottomSheet>

      <HandOverPrincipalSheet
        isOpen={isHandOverOpen}
        onClose={() => setIsHandOverOpen(false)}
        eligibleSuccessors={staff
          .filter((m) => m.is_active && m.role !== "principal")
          .map((m) => ({ userId: m.user_id, fullName: m.full_name }))}
        onHandedOver={(outcome, stayingRole) => {
          setIsHandOverOpen(false);
          if (outcome === "staying" && stayingRole) {
            router.push(getPostAuthRedirect(stayingRole));
          } else {
            router.push("/teacher/join-institution");
          }
        }}
      />

      {institutionId && (
        <SetStartTimeSheet
          isOpen={isStartTimeOpen}
          institutionId={institutionId}
          currentStartTime={startTime}
          onClose={() => setIsStartTimeOpen(false)}
          onSaved={(newStartTime) => {
            setStartTime(newStartTime);
            setIsStartTimeOpen(false);
          }}
        />
      )}

      {institutionId && (
        <SetCutoffSheet
          isOpen={isCutoffOpen}
          institutionId={institutionId}
          currentCutoffTime={cutoffTime}
          onClose={() => setIsCutoffOpen(false)}
          onSaved={(newCutoff) => {
            setCutoffTime(newCutoff);
            setIsCutoffOpen(false);
          }}
        />
      )}

      <PrincipalBottomNav />
    </div>
  );
}
