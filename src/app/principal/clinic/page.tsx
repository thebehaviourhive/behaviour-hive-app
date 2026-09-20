"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRedirect } from "@/lib/roleRedirect";
import { useInstitutionType } from "@/hooks/useInstitutionType";
import { PrincipalBottomNav } from "@/components/principal/PrincipalBottomNav";
import { HandOverPrincipalSheet } from "@/components/principal/HandOverPrincipalSheet";
import { SetClinicHoursSheet } from "@/components/principal/SetClinicHoursSheet";
import { SetBookingBufferSheet } from "@/components/principal/SetBookingBufferSheet";
import { SetBookingWindowSheet } from "@/components/principal/SetBookingWindowSheet";
import { SetCancellationNoticeSheet } from "@/components/principal/SetCancellationNoticeSheet";
import { SetCancellationPolicySheet } from "@/components/principal/SetCancellationPolicySheet";
import { formatTimeOfDay } from "@/lib/temporaryAccessTime";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";

// Clinical director's dashboard, Step 0 recon -- the clinic-side
// sibling of /principal/school, per Daniel's own confirmation: "Clinic"
// carries the institution code, account administration (unchanged,
// reused wholesale from School), AND the three PRD 9 scheduling RPCs
// (set_clinic_hours/set_booking_buffer_minutes/set_booking_window_days),
// which had working RPCs and no UI home anywhere until now. A genuinely
// separate page, not a conditional branch inside School's own 380-line
// file -- the settings themselves are structurally different (clinic
// hours vs. a school day's temporary-cover window, a booking buffer/
// window vs. incident locations), matching this schema's own "same
// shape, not same table" precedent rather than forcing one component to
// carry two unrelated settings vocabularies.
//
// Guards against a school principal landing here by direct URL --
// nothing in the clinic nav ever links here for a school, but the route
// itself would otherwise happily render clinic-only settings for
// someone whose institution has none of these columns doing anything.

interface StaffRow {
  user_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

export default function PrincipalClinicPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("principal");
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [institutionCode, setInstitutionCode] = useState<string | null>(null);
  const [isCodeCopied, setIsCodeCopied] = useState(false);
  const [clinicHoursStart, setClinicHoursStart] = useState<string>("09:00:00");
  const [clinicHoursEnd, setClinicHoursEnd] = useState<string>("17:00:00");
  const [bookingBufferMinutes, setBookingBufferMinutes] = useState<number>(15);
  const [bookingWindowDays, setBookingWindowDays] = useState<number>(30);
  const [cancellationNoticeHours, setCancellationNoticeHours] = useState<number>(24);
  const [cancellationPolicyText, setCancellationPolicyText] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isHandOverOpen, setIsHandOverOpen] = useState(false);
  const [isClinicHoursOpen, setIsClinicHoursOpen] = useState(false);
  const [isBookingBufferOpen, setIsBookingBufferOpen] = useState(false);
  const [isBookingWindowOpen, setIsBookingWindowOpen] = useState(false);
  const [isCancellationNoticeOpen, setIsCancellationNoticeOpen] = useState(false);
  const [isCancellationPolicyOpen, setIsCancellationPolicyOpen] = useState(false);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [isLogOutOpen, setIsLogOutOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  // A school principal reaching this route directly (no nav link ever
  // points here for them) is redirected to their own real settings page
  // rather than shown controls that do nothing for their institution.
  const { institutionType, isLoading: isInstitutionTypeLoading } = useInstitutionType(institutionId);
  useEffect(() => {
    if (!isInstitutionTypeLoading && institutionId && institutionType === "school") {
      router.replace("/principal/school");
    }
  }, [isInstitutionTypeLoading, institutionId, institutionType, router]);

  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    const supabase = createClient();

    const { data: staffRow, error: staffError } = await supabase
      .from("institution_staff")
      .select(
        "institution_id, institutions(name, institution_code, clinic_hours_start_time, clinic_hours_end_time, booking_buffer_minutes, booking_window_days, cancellation_notice_hours, cancellation_policy_text)"
      )
      .eq("user_id", user.id)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (staffError || !staffRow) {
      setError("Could not find your clinic.");
      setIsLoading(false);
      return;
    }

    interface ClinicSettingsRecord {
      name: string;
      institution_code: string;
      clinic_hours_start_time: string | null;
      clinic_hours_end_time: string | null;
      booking_buffer_minutes: number | null;
      booking_window_days: number | null;
      cancellation_notice_hours: number | null;
      cancellation_policy_text: string | null;
    }
    const institutionRecord = staffRow.institutions as unknown as ClinicSettingsRecord | ClinicSettingsRecord[] | null;
    const record = Array.isArray(institutionRecord) ? institutionRecord[0] : institutionRecord;
    setInstitutionName(record?.name ?? null);
    setInstitutionCode(record?.institution_code ?? null);
    setInstitutionId(staffRow.institution_id);
    if (record?.clinic_hours_start_time) setClinicHoursStart(record.clinic_hours_start_time);
    if (record?.clinic_hours_end_time) setClinicHoursEnd(record.clinic_hours_end_time);
    if (record?.booking_buffer_minutes !== null && record?.booking_buffer_minutes !== undefined) {
      setBookingBufferMinutes(record.booking_buffer_minutes);
    }
    if (record?.booking_window_days !== null && record?.booking_window_days !== undefined) {
      setBookingWindowDays(record.booking_window_days);
    }
    if (record?.cancellation_notice_hours !== null && record?.cancellation_notice_hours !== undefined) {
      setCancellationNoticeHours(record.cancellation_notice_hours);
    }
    setCancellationPolicyText(record?.cancellation_policy_text ?? null);

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
        <h1 className="font-heading text-h1 font-bold text-brand-prussian-blue">Clinic</h1>
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
                  Clinic Code
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
                  Share this with a new practitioner, clinical lead, or admin so they can join {institutionName ?? "your clinic"}. They&apos;ll enter it at sign-up.
                </p>
              </section>

              <section className="mt-16">
                <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
                  Scheduling
                </h2>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                    <div>
                      <p className="font-sans text-body font-semibold text-brand-neutral-black">Clinic hours</p>
                      <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/50">
                        {formatTimeOfDay(clinicHoursStart)} – {formatTimeOfDay(clinicHoursEnd)}, every day
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsClinicHoursOpen(true)}
                      className="flex-shrink-0 font-sans text-body font-semibold text-brand-prussian-blue"
                    >
                      Change
                    </button>
                  </div>

                  <div className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                    <div>
                      <p className="font-sans text-body font-semibold text-brand-neutral-black">Booking buffer</p>
                      <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/50">
                        {bookingBufferMinutes} minutes clear before and after every appointment
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsBookingBufferOpen(true)}
                      className="flex-shrink-0 font-sans text-body font-semibold text-brand-prussian-blue"
                    >
                      Change
                    </button>
                  </div>

                  <div className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                    <div>
                      <p className="font-sans text-body font-semibold text-brand-neutral-black">Booking window</p>
                      <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/50">
                        Parents can book up to {bookingWindowDays} days ahead
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsBookingWindowOpen(true)}
                      className="flex-shrink-0 font-sans text-body font-semibold text-brand-prussian-blue"
                    >
                      Change
                    </button>
                  </div>
                </div>
              </section>

              <section className="mt-16">
                <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
                  Cancellation Policy
                </h2>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                    <div>
                      <p className="font-sans text-body font-semibold text-brand-neutral-black">Notice period</p>
                      <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/50">
                        {cancellationNoticeHours} hours -- shown as a warning, never a block
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsCancellationNoticeOpen(true)}
                      className="flex-shrink-0 font-sans text-body font-semibold text-brand-prussian-blue"
                    >
                      Change
                    </button>
                  </div>

                  <div className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                    <div>
                      <p className="font-sans text-body font-semibold text-brand-neutral-black">Policy text</p>
                      <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/50">
                        {cancellationPolicyText ? (
                          cancellationPolicyText.length > 80 ? `${cancellationPolicyText.slice(0, 80)}…` : cancellationPolicyText
                        ) : (
                          <span className="text-brand-golden-brown">Not set -- parents will see no policy at booking</span>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsCancellationPolicyOpen(true)}
                      className="flex-shrink-0 font-sans text-body font-semibold text-brand-prussian-blue"
                    >
                      Change
                    </button>
                  </div>
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

      {institutionId && (
        <HandOverPrincipalSheet
          isOpen={isHandOverOpen}
          onClose={() => setIsHandOverOpen(false)}
          institutionId={institutionId}
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
      )}

      {institutionId && (
        <SetClinicHoursSheet
          isOpen={isClinicHoursOpen}
          institutionId={institutionId}
          currentStartTime={clinicHoursStart}
          currentEndTime={clinicHoursEnd}
          onClose={() => setIsClinicHoursOpen(false)}
          onSaved={(newStart, newEnd) => {
            setClinicHoursStart(newStart);
            setClinicHoursEnd(newEnd);
            setIsClinicHoursOpen(false);
          }}
        />
      )}

      {institutionId && (
        <SetBookingBufferSheet
          isOpen={isBookingBufferOpen}
          institutionId={institutionId}
          currentMinutes={bookingBufferMinutes}
          onClose={() => setIsBookingBufferOpen(false)}
          onSaved={(newMinutes) => {
            setBookingBufferMinutes(newMinutes);
            setIsBookingBufferOpen(false);
          }}
        />
      )}

      {institutionId && (
        <SetBookingWindowSheet
          isOpen={isBookingWindowOpen}
          institutionId={institutionId}
          currentDays={bookingWindowDays}
          onClose={() => setIsBookingWindowOpen(false)}
          onSaved={(newDays) => {
            setBookingWindowDays(newDays);
            setIsBookingWindowOpen(false);
          }}
        />
      )}

      {institutionId && (
        <SetCancellationNoticeSheet
          isOpen={isCancellationNoticeOpen}
          institutionId={institutionId}
          currentHours={cancellationNoticeHours}
          onClose={() => setIsCancellationNoticeOpen(false)}
          onSaved={(newHours) => {
            setCancellationNoticeHours(newHours);
            setIsCancellationNoticeOpen(false);
          }}
        />
      )}

      {institutionId && (
        <SetCancellationPolicySheet
          isOpen={isCancellationPolicyOpen}
          institutionId={institutionId}
          currentText={cancellationPolicyText}
          onClose={() => setIsCancellationPolicyOpen(false)}
          onSaved={(newText) => {
            setCancellationPolicyText(newText);
            setIsCancellationPolicyOpen(false);
          }}
        />
      )}

      <PrincipalBottomNav />
    </div>
  );
}
