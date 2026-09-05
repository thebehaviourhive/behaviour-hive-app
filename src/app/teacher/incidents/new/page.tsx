"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionRoster } from "@/hooks/useInstitutionRoster";
import { useTaskTiming } from "@/hooks/useTaskTiming";
import { logAppEvent } from "@/lib/logAppEvent";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { TextField } from "@/components/ui/TextField";

// School Incident Log -- Phase 3, the 15-second stamp. Four fields only,
// matching the paper form's own stage one: which child (up to two, per
// the two-child cap -- decision/J2), when, where, and who else was
// present. Everything else (narrative, category, actions, restrictive
// practice, injuries, debrief) is stage two, a separate screen reached
// after this one, not built in this pass.
//
// Tone: clinical, matching the rest of this module -- plain, precise,
// no encouragement or reassurance copy, unlike the rest of this app's
// onboarding-adjacent screens.
//
// Child/staff selection draws from the INSTITUTION roster
// (useInstitutionRoster, migration 0074), not the caller's own
// passport_access -- decisions 1 and 5. The creator is pre-selected in
// the staff list by default (they're implicitly present, being the one
// stamping this) but can be deselected if someone is stamping on a
// colleague's behalf.

interface LocationOption {
  id: string;
  value: string;
}

function nowForDatetimeLocalInput(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
}

export default function NewIncidentStampPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole(["class_teacher", "sna", "principal"]);
  const { isLoading: isRosterLoading, error: rosterError, institutionId, children, staff } = useInstitutionRoster(
    user?.id ?? null
  );

  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(true);

  const [occurredAt, setOccurredAt] = useState(nowForDatetimeLocalInput);
  const [locationId, setLocationId] = useState("");
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [freeTextStaff, setFreeTextStaff] = useState<string[]>([]);
  const [freeTextInput, setFreeTextInput] = useState("");

  // Time-on-task, Pass 1 -- "how long does the 15-second stamp actually
  // take" (nothing answers this today; see CLAUDE.md). Both values
  // ride along on the create_incident_stamp() call below, no extra
  // network round trip. Pass 2's task_started fires on this same first-
  // input moment, not on mount -- an accidental navigation into this
  // screen must not count as a started stamp.
  const { screenOpenedAt, firstInputAt, markFirstInput } = useTaskTiming(() =>
    logAppEvent({ route: "/teacher/incidents/new", eventType: "task_started", institutionId, metadata: { task: "incident_stamp" } })
  );

  // "Adjusting state when a prop changes" -- computed during render, not
  // in an effect (React's own documented pattern for this shape of
  // problem): the creator is present by construction, so pre-select
  // them the moment the roster loads, guarded on user.id so it only
  // (re-)runs once per signed-in user, not on every render.
  const [preselectedForUserId, setPreselectedForUserId] = useState<string | null>(null);
  if (user && staff.length > 0 && preselectedForUserId !== user.id) {
    setPreselectedForUserId(user.id);
    setSelectedStaffIds(staff.some((member) => member.userId === user.id) ? [user.id] : []);
  }

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!institutionId) return;
    let isMounted = true;

    async function loadLocations() {
      const supabase = createClient();
      const { data, error: locationsError } = await supabase
        .from("incident_locations")
        .select("id, value")
        .or(`institution_id.is.null,institution_id.eq.${institutionId}`)
        .eq("is_active", true)
        .order("sort_order");

      if (!isMounted) return;
      if (!locationsError) setLocations(data ?? []);
      setIsLoadingLocations(false);
    }

    loadLocations();
    return () => {
      isMounted = false;
    };
  }, [institutionId]);

  if (!isReady) {
    return null;
  }

  function toggleChild(passportId: string) {
    setSelectedChildIds((current) => {
      if (current.includes(passportId)) return current.filter((id) => id !== passportId);
      if (current.length >= 2) return current;
      return [...current, passportId];
    });
  }

  function toggleStaff(userId: string) {
    setSelectedStaffIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    );
  }

  function addFreeTextStaff() {
    const name = freeTextInput.trim();
    if (!name || freeTextStaff.includes(name)) return;
    setFreeTextStaff((current) => [...current, name]);
    setFreeTextInput("");
  }

  function removeFreeTextStaff(name: string) {
    setFreeTextStaff((current) => current.filter((n) => n !== name));
  }

  async function handleSubmit() {
    if (!institutionId || selectedChildIds.length === 0 || !locationId || !occurredAt) return;

    setIsSubmitting(true);
    setError(null);

    const supabase = createClient();
    const staffPayload = [
      ...selectedStaffIds.map((userId) => ({ user_id: userId })),
      ...freeTextStaff.map((name) => ({ free_text_name: name })),
    ];

    const { data: incidentId, error: stampError } = await supabase.rpc("create_incident_stamp", {
      p_institution_id: institutionId,
      p_occurred_at: new Date(occurredAt).toISOString(),
      p_location_id: locationId,
      p_child_passport_ids: selectedChildIds,
      p_staff: staffPayload,
      p_client_opened_at: screenOpenedAt,
      p_client_first_input_at: firstInputAt,
    });

    setIsSubmitting(false);

    if (stampError) {
      setError(stampError.message);
      return;
    }

    router.push(`/teacher/incidents/${incidentId}`);
  }

  const canSubmit = selectedChildIds.length > 0 && Boolean(locationId) && Boolean(occurredAt) && !isSubmitting;
  const isLoading = isRosterLoading || isLoadingLocations;

  return (
    <div
      className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-10"
      onFocusCapture={markFirstInput}
      onClickCapture={markFirstInput}
    >
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <button
          type="button"
          onClick={() => {
            // Pass 2 -- only a cancellation if a task was actually
            // started (firstInputAt set); backing out of an untouched
            // screen isn't abandoning anything, it's just leaving.
            if (firstInputAt) {
              logAppEvent({ route: "/teacher/incidents/new", eventType: "task_cancelled", institutionId, metadata: { task: "incident_stamp" } });
            }
            router.back();
          }}
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </button>
        <div>
          <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Record Incident</h1>
          <p className="text-xs text-brand-neutral-black/50">Child, time, location, staff present.</p>
        </div>
      </header>

      <main className="flex-1 px-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : rosterError ? (
          <p className="text-sm text-brand-neutral-black/60">{rosterError}</p>
        ) : (
          <div className="flex flex-col gap-6">
            <section>
              <label htmlFor="occurred-at" className="text-sm font-semibold text-brand-neutral-black">
                When
              </label>
              <input
                id="occurred-at"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                max={nowForDatetimeLocalInput()}
                className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              />
            </section>

            <section>
              <label htmlFor="location" className="text-sm font-semibold text-brand-neutral-black">
                Where
              </label>
              <select
                id="location"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              >
                <option value="">Select a location</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.value}
                  </option>
                ))}
              </select>
            </section>

            <section>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-sm font-semibold text-brand-neutral-black">Child</span>
                <span className="text-xs text-brand-neutral-black/50">Up to two</span>
              </div>
              {children.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                  No children are linked to this institution yet.
                </p>
              ) : (
                <div className="flex flex-col gap-2.5 rounded-2xl border border-black/5 bg-white p-4">
                  {children.map((child) => (
                    <Checkbox
                      key={child.passportId}
                      id={`child-${child.passportId}`}
                      checked={selectedChildIds.includes(child.passportId)}
                      onChange={() => toggleChild(child.passportId)}
                      label={child.childName}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Staff present</span>
              {staff.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                  No other staff are registered at this institution yet.
                </p>
              ) : (
                <div className="flex flex-col gap-2.5 rounded-2xl border border-black/5 bg-white p-4">
                  {staff.map((member) => (
                    <Checkbox
                      key={member.userId}
                      id={`staff-${member.userId}`}
                      checked={selectedStaffIds.includes(member.userId)}
                      onChange={() => toggleStaff(member.userId)}
                      label={member.fullName}
                    />
                  ))}
                </div>
              )}

              {freeTextStaff.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {freeTextStaff.map((name) => (
                    <span
                      key={name}
                      className="flex items-center gap-1.5 rounded-full bg-brand-pastel-blue/20 px-3 py-1 text-xs font-semibold text-brand-prussian-blue"
                    >
                      {name}
                      <button type="button" onClick={() => removeFreeTextStaff(name)} aria-label={`Remove ${name}`}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-2 flex gap-2">
                <TextField
                  label="Someone not on this list"
                  id="free-text-staff"
                  value={freeTextInput}
                  onChange={(e) => setFreeTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addFreeTextStaff();
                    }
                  }}
                  placeholder="e.g. Bus escort"
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={addFreeTextStaff}
                  disabled={!freeTextInput.trim()}
                  className="mt-[1.9rem] flex-shrink-0 rounded-xl border-2 border-brand-prussian-blue px-4 py-3 text-sm font-semibold text-brand-prussian-blue disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </section>

            {error && (
              <p role="alert" className="text-sm font-medium text-red-600">
                {error}
              </p>
            )}

            <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
              {isSubmitting ? "Recording…" : "Record"}
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
