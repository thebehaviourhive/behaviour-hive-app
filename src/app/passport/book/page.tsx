"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useMyPassport } from "@/hooks/useMyPassport";
import { createClient } from "@/lib/supabase/client";
import { CLINICIAN_SPECIALTY_LABEL, type ClinicianSpecialty } from "@/lib/clinicianSpecialties";
import { Button } from "@/components/ui/Button";
import { CheckIcon } from "@/components/ui/icons";

// PRD 9, Stage 2 -- the parent-facing booking flow. Lives under
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
// Reached two ways, both real: a "Book a Session" tile on Home
// (QuickActionButtons, no clinicianId -- shows the picker below) or a
// contextual "Book" button beside a specific clinician's name in
// YourTeamCard (?clinicianId=... -- skips straight to session type).
// Both are legitimate, per Daniel's own instruction: the contextual one
// is free and it's where the thought happens ("I should book"); the
// tile is there for a parent who starts from intent rather than from
// looking at a clinician's name.
//
// Five steps: clinician (skipped if arriving with one already) -> type
// -> slot -> policy consent -> confirm. Type chosen before availability
// is computed (PRD 9 section 3a).
//
// Session types, fixed -> clinic-configurable catalogue (migration
// 0281) -- the "type" step used to be two hardcoded buttons (Online,
// In-person). It's now a real per-clinic catalogue read via
// get_bookable_session_types(), which already excludes anything
// retired or staff-only (is_active/is_parent_bookable both filtered
// server-side) -- this screen never needs its own boundary check the
// way the old literal-string comparison did, since a type that
// shouldn't be offered simply never appears in the list.

interface BookableClinician {
  clinicianId: string;
  fullName: string;
  specialty: string;
}

interface BookableSessionType {
  id: string;
  name: string;
  description: string | null;
  locationMode: string;
  lengthMinutes: number;
}

interface AvailableSlot {
  startISO: string;
  endISO: string;
}

type Step = "clinician" | "type" | "slot" | "consent" | "confirmed";

function groupSlotsByDay(slots: AvailableSlot[]): { dateLabel: string; slots: AvailableSlot[] }[] {
  const groups = new Map<string, AvailableSlot[]>();
  for (const slot of slots) {
    const date = new Date(slot.startISO);
    const key = date.toDateString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(slot);
  }
  return Array.from(groups.entries()).map(([key, daySlots]) => ({
    dateLabel: new Date(key).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }),
    slots: daySlots,
  }));
}

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTypeSubtitle(type: BookableSessionType): string {
  if (type.description) return type.description;
  const modeLabel =
    type.locationMode === "online" ? "by video call" : type.locationMode === "in_person" ? "at the clinic" : "in person";
  return `${type.lengthMinutes} minutes, ${modeLabel}`;
}

export default function BookSessionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isReady } = useRequireRole("parent");
  const { passportId, childName, isLoading: isPassportLoading } = useMyPassport(user?.id);

  const preselectedClinicianId = searchParams.get("clinicianId");

  const [step, setStep] = useState<Step>(preselectedClinicianId ? "type" : "clinician");
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
  const [cancellationNoticeHours, setCancellationNoticeHours] = useState(24);
  const [cancellationPolicyText, setCancellationPolicyText] = useState<string | null>(null);

  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [hasAgreedToPolicy, setHasAgreedToPolicy] = useState(false);

  const [isBooking, setIsBooking] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [confirmedSummary, setConfirmedSummary] = useState<{
    clinicianName: string;
    sessionTypeName: string;
    startISO: string;
    endISO: string;
    meetLink: string | null;
  } | null>(null);

  useEffect(() => {
    if (step !== "clinician" || !passportId) return;
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
        const rows = (data ?? []) as { clinician_id: string; full_name: string; specialty: string; engaged_by: string }[];
        // Only institution-engaged clinicians are bookable this way --
        // a parent-engaged clinician (connected by the parent's own
        // code) is never on a clinic caseload for scheduling purposes,
        // matching get_bookable_clinician_details()'s own gate exactly.
        const bookable = rows
          .filter((row) => row.engaged_by === "institution")
          .map((row) => ({ clinicianId: row.clinician_id, fullName: row.full_name, specialty: row.specialty }));
        setClinicians(bookable);
        setIsLoadingClinicians(false);
      });
    return () => {
      isMounted = false;
    };
  }, [step, passportId]);

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
        setSessionTypes(
          rows.map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            locationMode: row.location_mode,
            lengthMinutes: row.length_minutes,
          }))
        );
        setIsLoadingTypes(false);
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
      const data = await response.json();
      if (!response.ok) {
        setSlotsError(data.error ?? "Couldn't load availability.");
        setIsLoadingSlots(false);
        return;
      }
      setSlots(data.slots ?? []);
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
        // First come, first served -- if someone else got there first,
        // say so plainly and send the parent back to a freshly-loaded
        // slot list, never a silent retry.
        setBookingError(data.error ?? "Something went wrong. Please try again.");
        if (response.status === 409) {
          setStep("slot");
          loadSlots();
        }
        return;
      }
      setConfirmedSummary({
        clinicianName: data.clinicianName,
        sessionTypeName: data.sessionTypeName,
        startISO: data.sessionStartISO,
        endISO: data.sessionEndISO,
        meetLink: data.meetLink ?? null,
      });
      setStep("confirmed");
    } catch {
      setIsBooking(false);
      setBookingError("Something went wrong. Please try again.");
    }
  }

  function back() {
    // Bug 5, 22 Sept 2026 -- screen 1 (the clinician picker) had no
    // back arrow at all, unlike every later screen. There's no earlier
    // step in this flow to return to, so this leaves the flow entirely
    // -- the same destination the "Done" button on the confirmed
    // screen already uses.
    if (step === "clinician") router.push("/parent-dashboard");
    else if (step === "type" && !preselectedClinicianId) setStep("clinician");
    // Contextual entry (arriving with a clinician already chosen) has
    // no "clinician" step to return to from "type" either -- same
    // destination as above, not a dead button.
    else if (step === "type" && preselectedClinicianId) router.push("/parent-dashboard");
    else if (step === "slot") setStep("type");
    else if (step === "consent") setStep("slot");
  }

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

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
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
                    <button
                      key={clinician.clinicianId}
                      type="button"
                      onClick={() => pickClinician(clinician)}
                      className="rounded-2xl border border-black/5 bg-white p-4 text-left shadow-sm"
                    >
                      <p className="font-sans text-body font-semibold text-brand-neutral-black">{clinician.fullName}</p>
                      <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/50">
                        {CLINICIAN_SPECIALTY_LABEL[clinician.specialty as ClinicianSpecialty] ?? clinician.specialty}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {step === "type" && (
            <>
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
                  <p className="mb-2 font-sans text-body text-brand-neutral-black/60">
                    {selectedClinicianName ? `Booking with ${selectedClinicianName}. ` : ""}What kind of session?
                  </p>
                  {sessionTypes.map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => pickType(type)}
                      className="rounded-2xl border border-black/5 bg-white p-4 text-left shadow-sm"
                    >
                      <p className="font-sans text-body font-semibold text-brand-neutral-black">{type.name}</p>
                      <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/50">{formatTypeSubtitle(type)}</p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {step === "slot" && (
            <>
              {bookingError && (
                <p role="alert" className="mb-3 rounded-xl bg-brand-golden-brown/10 px-4 py-3 font-sans text-body font-medium text-brand-golden-brown">
                  {bookingError}
                </p>
              )}
              {isLoadingSlots ? (
                <div className="flex flex-col gap-2">
                  <div className="h-10 animate-pulse rounded-xl bg-white" />
                  <div className="h-10 animate-pulse rounded-xl bg-white" />
                </div>
              ) : slotsError ? (
                <p className="font-sans text-body text-brand-neutral-black/60">{slotsError}</p>
              ) : slots.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
                  No availability found in the current booking window. Please try again later.
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {groupSlotsByDay(slots).map((group) => (
                    <div key={group.dateLabel}>
                      <p className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                        {group.dateLabel}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {group.slots.map((slot) => (
                          <button
                            key={slot.startISO}
                            type="button"
                            onClick={() => pickSlot(slot)}
                            className="rounded-xl border border-brand-prussian-blue px-4 py-2 font-sans text-body font-semibold text-brand-prussian-blue"
                          >
                            {formatSlotTime(slot.startISO)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {step === "consent" && selectedSlot && selectedType && (
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                <p className="font-sans text-body font-semibold text-brand-neutral-black">
                  {selectedType.name} with {selectedClinicianName}
                </p>
                <p className="mt-0.5 font-sans text-body text-brand-neutral-black/60">
                  {new Date(selectedSlot.startISO).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
                  {" · "}
                  {formatSlotTime(selectedSlot.startISO)}–{formatSlotTime(selectedSlot.endISO)}
                </p>
              </div>

              <div className="rounded-2xl bg-brand-safe-ivory/40 p-4">
                <p className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  Cancellation Policy
                </p>
                {/* Bug 3, 22 Sept 2026 -- this used to render BOTH the
                    director's own text AND a generated notice-period
                    sentence together, saying the same thing twice. The
                    generated sentence is now only the fallback for a
                    clinic that hasn't written a policy at all -- never
                    shown alongside the director's own words. */}
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

          {step === "confirmed" && confirmedSummary && (
            <div className="flex flex-col items-center gap-2 rounded-2xl bg-white p-8 text-center shadow-sm">
              <CheckIcon className="mb-2 h-8 w-8 text-brand-prussian-blue" />
              <p className="font-heading text-h2 font-semibold text-brand-neutral-black">Booked.</p>
              <p className="font-sans text-body text-brand-neutral-black/70">
                {confirmedSummary.sessionTypeName} with {confirmedSummary.clinicianName}
                <br />
                {new Date(confirmedSummary.startISO).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
                {" · "}
                {formatSlotTime(confirmedSummary.startISO)}–{formatSlotTime(confirmedSummary.endISO)}
              </p>
              <p className="mt-2 font-sans text-eyebrow text-brand-neutral-black/50">
                A calendar invite has been sent to your email.
              </p>
              {confirmedSummary.meetLink && (
                <a
                  href={confirmedSummary.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 w-full rounded-2xl border border-brand-prussian-blue bg-brand-pastel-blue/20 px-6 py-3.5 text-center font-sans text-body font-semibold text-brand-prussian-blue"
                >
                  Join by video call
                </a>
              )}
              <Link
                href="/parent-dashboard"
                className="mt-4 rounded-2xl bg-brand-prussian-blue px-6 py-3 font-sans text-body font-semibold text-white"
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
