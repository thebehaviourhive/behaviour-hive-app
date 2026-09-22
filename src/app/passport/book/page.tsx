"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useMyPassport } from "@/hooks/useMyPassport";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { CheckIcon } from "@/components/ui/icons";
import { StepIndicator } from "@/components/parent/booking/StepIndicator";
import { ClinicianCard, type BookableClinician } from "@/components/parent/booking/ClinicianCard";
import { SessionTypeCard, type BookableSessionType } from "@/components/parent/booking/SessionTypeCard";
import { SlotPicker, type AvailableSlot } from "@/components/parent/booking/SlotPicker";
import { BookingSummaryCard, type BookingSummaryDetails } from "@/components/parent/booking/BookingSummaryCard";

// Booking-flow redesign (design brief, Sept 2026). Lives under
// /passport/* deliberately, not as a fourth nav tab: this app's own
// nav is three tabs (Home/Passport/More, BottomNav.tsx), and booking is
// an action a parent initiates, not a record they review -- the
// Home/Passport split this project already established decides that,
// it doesn't need a new destination. /passport/book is a mild routing
// hack, worth saying plainly rather than leaving someone to wonder why
// a booking FLOW sits under the RECORD's own route prefix: it's here
// only so BottomNav's own isActive matcher (pathname.startsWith
// "/passport")) correctly highlights "Passport" as the active tab
// while a parent is mid-booking, at zero cost to the nav itself -- no
// new tab, no new matcher, nothing else changes.
//
// Five steps (brief section 5): clinician -> type -> slot -> consent
// -> confirmed ("Booked"). The first two are genuinely skippable --
// "Skipped entirely when the child has one bookable clinician" /
// "A clinic offering a single kind of session should skip this step
// entirely" -- tracked via didSkipClinicianStep/didSkipTypeStep so
// both the step indicator's own total and the back button's own
// target correctly account for whichever steps this specific parent
// never actually saw. The booking LOGIC underneath is unchanged
// (brief section 9) -- this file only reorganises how the existing
// RPCs/routes are called and rendered.

interface AvailabilityResponse {
  clinicianName: string;
  clinicianSpecialty: string;
  slots: AvailableSlot[];
  bookingWindowDays: number;
  institutionId: string | null;
  cancellationNoticeHours: number;
  cancellationPolicyText: string | null;
}

type Step = "clinician" | "type" | "slot" | "consent" | "confirmed";

export default function BookSessionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isReady } = useRequireRole("parent");
  const { passportId, childName, isLoading: isPassportLoading } = useMyPassport(user?.id);

  const preselectedClinicianId = searchParams.get("clinicianId");

  const [step, setStep] = useState<Step>(preselectedClinicianId ? "type" : "clinician");
  const [didSkipClinicianStep, setDidSkipClinicianStep] = useState(false);
  const [didSkipTypeStep, setDidSkipTypeStep] = useState(false);

  const [clinicians, setClinicians] = useState<BookableClinician[]>([]);
  const [isLoadingClinicians, setIsLoadingClinicians] = useState(false);
  const [cliniciansError, setCliniciansError] = useState<string | null>(null);

  const [selectedClinicianId, setSelectedClinicianId] = useState<string | null>(preselectedClinicianId);
  const [selectedClinicianName, setSelectedClinicianName] = useState<string | null>(null);

  const [sessionTypes, setSessionTypes] = useState<BookableSessionType[]>([]);
  const [isLoadingTypes, setIsLoadingTypes] = useState(false);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<BookableSessionType | null>(null);

  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [bookingWindowDays, setBookingWindowDays] = useState(30);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [institutionAddress, setInstitutionAddress] = useState<string | null>(null);
  const [cancellationNoticeHours, setCancellationNoticeHours] = useState(24);
  const [cancellationPolicyText, setCancellationPolicyText] = useState<string | null>(null);
  const [slotGoneMessage, setSlotGoneMessage] = useState<string | null>(null);

  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [hasAgreedToPolicy, setHasAgreedToPolicy] = useState(false);

  const [isBooking, setIsBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [confirmedMeetLink, setConfirmedMeetLink] = useState<string | null>(null);

  // Always fetched, regardless of entry point -- a contextual arrival
  // (?clinicianId=...) already knows WHICH clinician, but still needs
  // this RPC's own organisation name/specialty for later screens
  // (design brief: "the organisation they practise at, small").
  useEffect(() => {
    if (!passportId) return;
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoadingClinicians(true);
    setCliniciansError(null);
    const supabase = createClient();
    supabase
      .rpc("get_passport_clinicians", { p_passport_id: passportId })
      .then(({ data, error }: { data: unknown; error: { message: string } | null }) => {
        if (!isMounted) return;
        if (error) {
          setCliniciansError("Couldn't load your clinical team.");
          setIsLoadingClinicians(false);
          return;
        }
        const rows = (data ?? []) as {
          clinician_id: string;
          full_name: string;
          specialty: string;
          engaged_by: string;
          engaged_by_institution_name: string | null;
        }[];
        // Only institution-engaged clinicians are bookable this way --
        // a parent-engaged clinician (connected by the parent's own
        // code) is never on a clinic caseload for scheduling purposes,
        // matching get_bookable_clinician_details()'s own gate exactly.
        const bookable: BookableClinician[] = rows
          .filter((row) => row.engaged_by === "institution")
          .map((row) => ({
            clinicianId: row.clinician_id,
            fullName: row.full_name,
            specialty: row.specialty,
            organisationName: row.engaged_by_institution_name,
          }));
        setClinicians(bookable);
        setIsLoadingClinicians(false);

        if (preselectedClinicianId) {
          const match = bookable.find((c) => c.clinicianId === preselectedClinicianId);
          if (match) {
            setSelectedClinicianName(match.fullName);
          }
        } else if (bookable.length === 1) {
          // Design brief: "Skipped entirely when the child has one
          // bookable clinician... Most parents will never see this
          // screen." Not just the contextual-entry case -- also true
          // from the general "Book a Session" tile whenever there's
          // only ever one real choice.
          setSelectedClinicianId(bookable[0].clinicianId);
          setSelectedClinicianName(bookable[0].fullName);
          setDidSkipClinicianStep(true);
          setStep("type");
        }
      });
    return () => {
      isMounted = false;
    };
  }, [passportId, preselectedClinicianId]);

  useEffect(() => {
    if (step !== "type" || !passportId || !selectedClinicianId) return;
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoadingTypes(true);
    setTypesError(null);
    const supabase = createClient();
    supabase
      .rpc("get_bookable_session_types", { p_passport_id: passportId, p_clinician_id: selectedClinicianId })
      .then(({ data, error }: { data: unknown; error: { message: string } | null }) => {
        if (!isMounted) return;
        if (error) {
          setTypesError("Couldn't load session types.");
          setIsLoadingTypes(false);
          return;
        }
        const rows = (data ?? []) as {
          id: string;
          name: string;
          description: string | null;
          location_mode: string;
          length_minutes: number;
        }[];
        const types: BookableSessionType[] = rows.map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          locationMode: row.location_mode,
          lengthMinutes: row.length_minutes,
        }));
        setSessionTypes(types);
        setIsLoadingTypes(false);
        if (types.length === 1) {
          // Design brief: "A clinic offering a single kind of session
          // should skip this step entirely, as the clinician step
          // already does."
          setSelectedType(types[0]);
          setDidSkipTypeStep(true);
          setStep("slot");
        }
      });
    return () => {
      isMounted = false;
    };
  }, [step, passportId, selectedClinicianId]);

  const loadSlots = useCallback(async () => {
    if (!passportId || !selectedClinicianId || !selectedType) return;
    setIsLoadingSlots(true);
    setSlotsError(null);
    setSelectedSlot(null);
    try {
      const params = new URLSearchParams({ passportId, clinicianId: selectedClinicianId, sessionTypeId: selectedType.id });
      const response = await fetch(`/api/scheduling/availability?${params.toString()}`);
      const data: AvailabilityResponse & { error?: string } = await response.json();
      if (!response.ok) {
        setSlotsError(data.error ?? "Couldn't load availability.");
        setIsLoadingSlots(false);
        return;
      }
      setSlots(data.slots ?? []);
      setBookingWindowDays(data.bookingWindowDays ?? 30);
      setInstitutionId(data.institutionId ?? null);
      setCancellationNoticeHours(data.cancellationNoticeHours ?? 24);
      setCancellationPolicyText(data.cancellationPolicyText ?? null);
      setSelectedClinicianName((prev) => prev ?? data.clinicianName ?? null);
      setIsLoadingSlots(false);
    } catch {
      setSlotsError("Couldn't load availability.");
      setIsLoadingSlots(false);
    }
  }, [passportId, selectedClinicianId, selectedType]);

  useEffect(() => {
    if (step === "slot") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadSlots();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectedClinicianId, selectedType]);

  // The clinic's own address (design brief step 4: "the clinic's
  // address for in-person"). institutions' own SELECT policy is
  // `using (true)` (0013) -- a direct client read, not a second RPC,
  // once institutionId is known from the availability response.
  useEffect(() => {
    if (!institutionId) return;
    let isMounted = true;
    const supabase = createClient();
    supabase
      .from("institutions")
      .select("address")
      .eq("id", institutionId)
      .maybeSingle()
      .then(({ data }: { data: { address: string | null } | null }) => {
        if (!isMounted) return;
        setInstitutionAddress(data?.address ?? null);
      });
    return () => {
      isMounted = false;
    };
  }, [institutionId]);

  function pickClinician(clinician: BookableClinician) {
    setSelectedClinicianId(clinician.clinicianId);
    setSelectedClinicianName(clinician.fullName);
    setStep("type");
  }

  function pickType(type: BookableSessionType) {
    setSelectedType(type);
    setStep("slot");
  }

  function pickSlot(slot: AvailableSlot) {
    setSelectedSlot(slot);
    setHasAgreedToPolicy(false);
    setBookingError(null);
    setStep("consent");
  }

  async function confirmBooking() {
    if (!passportId || !selectedClinicianId || !selectedType || !selectedSlot) return;
    setIsBooking(true);
    setBookingError(null);
    try {
      const response = await fetch("/api/scheduling/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passportId,
          clinicianId: selectedClinicianId,
          sessionTypeId: selectedType.id,
          sessionStartISO: selectedSlot.startISO,
          sessionEndISO: selectedSlot.endISO,
        }),
      });
      const data = await response.json();
      setIsBooking(false);
      if (!response.ok) {
        if (response.status === 409) {
          // Design brief, section 6: "the slot has just gone... design
          // it as a gentle interruption, not an error." A dedicated
          // message (never bookingError's own generic styling) shown
          // above a freshly-reloaded SlotPicker, not a dead end.
          setSlotGoneMessage("That time was just taken. Here's what's still available.");
          setStep("slot");
          loadSlots();
          return;
        }
        setBookingError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setConfirmedMeetLink(data.meetLink ?? null);
      setStep("confirmed");
    } catch {
      setIsBooking(false);
      setBookingError("Something went wrong. Please try again.");
    }
  }

  function back() {
    if (step === "clinician") {
      router.push("/parent-dashboard");
    } else if (step === "type") {
      if (didSkipClinicianStep || preselectedClinicianId) router.push("/parent-dashboard");
      else setStep("clinician");
    } else if (step === "slot") {
      setSlotGoneMessage(null);
      if (didSkipTypeStep) {
        if (didSkipClinicianStep || preselectedClinicianId) router.push("/parent-dashboard");
        else setStep("clinician");
      } else {
        setStep("type");
      }
    } else if (step === "consent") {
      setStep("slot");
    }
  }

  const visibleStepCount = useMemo(() => {
    let count = 2; // slot, consent -- always present
    if (!didSkipClinicianStep && !preselectedClinicianId) count += 1;
    if (!didSkipTypeStep) count += 1;
    return count;
  }, [didSkipClinicianStep, didSkipTypeStep, preselectedClinicianId]);

  const currentStepNumber = useMemo(() => {
    const hasClinicianStep = !didSkipClinicianStep && !preselectedClinicianId;
    const hasTypeStep = !didSkipTypeStep;
    if (step === "clinician") return 1;
    if (step === "type") return hasClinicianStep ? 2 : 1;
    if (step === "slot") return (hasClinicianStep ? 1 : 0) + (hasTypeStep ? 1 : 0) + 1;
    if (step === "consent") return (hasClinicianStep ? 1 : 0) + (hasTypeStep ? 1 : 0) + 2;
    return visibleStepCount;
  }, [step, didSkipClinicianStep, didSkipTypeStep, preselectedClinicianId, visibleStepCount]);

  if (!isReady || isPassportLoading) {
    return null;
  }

  if (!passportId) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-brand-off-white/40 p-6 text-center">
        <p className="font-sans text-body text-brand-neutral-black/60">Couldn&apos;t find your child&apos;s passport.</p>
      </div>
    );
  }

  const summaryDetails: BookingSummaryDetails | null =
    selectedSlot && selectedType && selectedClinicianName
      ? {
          clinicianName: selectedClinicianName,
          sessionTypeName: selectedType.name,
          locationMode: selectedType.locationMode,
          startISO: selectedSlot.startISO,
          endISO: selectedSlot.endISO,
          address: institutionAddress,
          meetLink: confirmedMeetLink,
        }
      : null;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center gap-3 px-4 pt-6 pb-2">
        {step !== "confirmed" && (
          <button type="button" onClick={back} aria-label="Back" className="text-brand-prussian-blue">
            ←
          </button>
        )}
        <div>
          <h1 className="font-heading text-h1 font-bold text-brand-prussian-blue">Book a Session</h1>
          {childName && <p className="mt-0.5 font-sans text-body text-brand-neutral-black/60">{childName}</p>}
        </div>
      </header>

      {step !== "confirmed" && <StepIndicator current={currentStepNumber} total={visibleStepCount} />}

      <main className="flex-1 px-4">
        <div className="lg:max-w-[66.6667%]">
          {step === "clinician" && (
            <>
              {isLoadingClinicians ? (
                <div className="flex flex-col gap-2">
                  <div className="h-16 animate-pulse rounded-2xl bg-white" />
                  <div className="h-16 animate-pulse rounded-2xl bg-white" />
                </div>
              ) : cliniciansError ? (
                <p className="font-sans text-body text-brand-neutral-black/60">{cliniciansError}</p>
              ) : clinicians.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
                  There&apos;s no clinician assigned by your clinic to book with yet.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="mb-2 font-sans text-body text-brand-neutral-black/60">Who would you like to book with?</p>
                  {clinicians.map((clinician) => (
                    <ClinicianCard key={clinician.clinicianId} clinician={clinician} onSelect={() => pickClinician(clinician)} />
                  ))}
                </div>
              )}
            </>
          )}

          {step === "type" && (
            <>
              {selectedClinicianName && (
                <p className="mb-3 font-sans text-eyebrow font-semibold uppercase tracking-wide text-brand-neutral-black/40">
                  Booking with {selectedClinicianName}
                </p>
              )}
              {isLoadingTypes ? (
                <div className="flex flex-col gap-2">
                  <div className="h-16 animate-pulse rounded-2xl bg-white" />
                  <div className="h-16 animate-pulse rounded-2xl bg-white" />
                </div>
              ) : typesError ? (
                <p className="font-sans text-body text-brand-neutral-black/60">{typesError}</p>
              ) : sessionTypes.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
                  Your clinic hasn&apos;t set up anything bookable here yet. Please contact them directly.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="mb-2 font-sans text-body text-brand-neutral-black/60">What kind of session?</p>
                  {sessionTypes.map((type) => (
                    <SessionTypeCard key={type.id} type={type} onSelect={() => pickType(type)} />
                  ))}
                </div>
              )}
            </>
          )}

          {step === "slot" && (
            <>
              {(selectedClinicianName || selectedType) && (
                <p className="mb-3 font-sans text-eyebrow font-semibold uppercase tracking-wide text-brand-neutral-black/40">
                  {selectedType?.name}
                  {selectedType && selectedClinicianName ? " with " : ""}
                  {selectedClinicianName}
                </p>
              )}
              {slotGoneMessage && (
                <p role="alert" className="mb-3 rounded-xl bg-brand-golden-brown/10 px-4 py-3 font-sans text-body font-medium text-brand-golden-brown">
                  {slotGoneMessage}
                </p>
              )}
              {isLoadingSlots ? (
                // Design brief, section 6: "a calm loading state, not a
                // blank screen" -- a day-strip-shaped skeleton, not a
                // generic bar, so the screen already reads as "the time
                // picker" before the real data lands.
                <div className="flex flex-col gap-4">
                  <div className="h-16 animate-pulse rounded-2xl bg-white" />
                  <div className="flex gap-2">
                    {Array.from({ length: 7 }, (_, i) => (
                      <div key={i} className="h-16 w-[52px] flex-shrink-0 animate-pulse rounded-xl bg-white" />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <div className="h-11 w-20 animate-pulse rounded-xl bg-white" />
                    <div className="h-11 w-20 animate-pulse rounded-xl bg-white" />
                    <div className="h-11 w-20 animate-pulse rounded-xl bg-white" />
                  </div>
                </div>
              ) : slotsError ? (
                <p className="font-sans text-body text-brand-neutral-black/60">{slotsError}</p>
              ) : (
                <SlotPicker slots={slots} bookingWindowDays={bookingWindowDays} onSelectSlot={pickSlot} />
              )}
            </>
          )}

          {step === "consent" && summaryDetails && (
            <div className="flex flex-col gap-4">
              <BookingSummaryCard details={summaryDetails} />

              <div className="rounded-2xl bg-brand-safe-ivory/40 p-4">
                <p className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  Cancellation Policy
                </p>
                {cancellationPolicyText ? (
                  <p className="mt-2 font-sans text-body text-brand-neutral-black/80">{cancellationPolicyText}</p>
                ) : (
                  <p className="mt-2 font-sans text-body text-brand-neutral-black/80">
                    Please give at least {cancellationNoticeHours} hours&apos; notice to cancel or change this session.
                  </p>
                )}
              </div>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={hasAgreedToPolicy}
                  onChange={(e) => setHasAgreedToPolicy(e.target.checked)}
                  className="mt-1 h-5 w-5 flex-shrink-0"
                />
                <span className="font-sans text-body text-brand-neutral-black/80">I agree to this cancellation policy.</span>
              </label>

              {bookingError && (
                <p role="alert" className="font-sans text-body font-medium text-brand-golden-brown">
                  {bookingError}
                </p>
              )}

              <Button type="button" onClick={confirmBooking} disabled={!hasAgreedToPolicy || isBooking}>
                {isBooking ? "Booking…" : "Book Session"}
              </Button>
            </div>
          )}

          {step === "confirmed" && summaryDetails && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col items-center gap-1 rounded-2xl bg-white p-6 text-center shadow-sm">
                <CheckIcon className="mb-1 h-8 w-8 text-brand-prussian-blue" />
                <p className="font-heading text-h2 font-semibold text-brand-neutral-black">Booked.</p>
              </div>

              <BookingSummaryCard details={summaryDetails} />

              <div className="rounded-2xl bg-brand-pastel-blue/15 p-4">
                <p className="font-sans text-body text-brand-neutral-black/80">
                  This is on your calendar and in the app, under Upcoming on Home.
                  {summaryDetails.locationMode === "online" && " The joining link above is on your calendar invitation too."}
                </p>
              </div>

              <div className="rounded-2xl bg-brand-safe-ivory/40 p-4">
                <p className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  Need to cancel?
                </p>
                <p className="mt-2 font-sans text-body text-brand-neutral-black/80">
                  You can cancel from Home, under Upcoming. Please give at least {cancellationNoticeHours} hours&apos; notice.
                </p>
              </div>

              <Link
                href="/parent-dashboard"
                className="rounded-2xl bg-brand-prussian-blue px-6 py-3.5 text-center font-sans text-body font-semibold text-white"
              >
                Done
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
