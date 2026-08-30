"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { Textarea } from "@/components/ui/Textarea";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { formatTimeOfDay, todayLocalDateString } from "@/lib/temporaryAccessTime";

// PRD 1, Stage 3, Step 3. Shared between the principal (any class at
// their institution, either an existing staff member OR a genuinely new
// supply teacher by email) and the class teacher (their own current
// class only, an existing active SNA colleague only) -- the UI doesn't
// decide who's allowed to grant what; grant_temporary_access() does,
// server-side. One component, two callers, matching every other shared
// sheet this stage and Stage 2 already built.
//
// Copy that has to be right, per Daniel's own instruction, because
// these are the constraints people will otherwise discover the hard
// way -- both stated here plainly, before any submission, not
// discovered as a runtime error:
//   - the tier ceiling (principal mode only -- the class-teacher mode's
//     target is already an SNA, so there is no ceiling to surprise
//     anyone with)
//   - the expiry window and what it means for unfinished work

interface EligiblePerson {
  userId: string;
  fullName: string;
}

interface GrantTemporaryAccessSheetProps {
  isOpen: boolean;
  mode: "principal" | "classTeacher";
  classId: string;
  className: string;
  institutionId: string;
  startTime: string;
  cutoffTime: string;
  eligibleExisting: EligiblePerson[]; // classTeacher mode: active SNAs. principal mode: all active staff.
  onClose: () => void;
  onGranted: () => void;
}

export function GrantTemporaryAccessSheet({
  isOpen,
  mode,
  classId,
  className,
  institutionId,
  startTime,
  cutoffTime,
  eligibleExisting,
  onClose,
  onGranted,
}: GrantTemporaryAccessSheetProps) {
  const [pickMode, setPickMode] = useState<"existing" | "email">("existing");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [email, setEmail] = useState("");
  const [lookedUpPerson, setLookedUpPerson] = useState<EligiblePerson | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [date, setDate] = useState(todayLocalDateString());
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function reset() {
    setPickMode("existing");
    setSelectedUserId("");
    setEmail("");
    setLookedUpPerson(null);
    setLookupError(null);
    setDate(todayLocalDateString());
    setReason("");
    setSubmitError(null);
  }

  function close() {
    if (isSubmitting) return;
    reset();
    onClose();
  }

  async function handleLookup() {
    if (!email.trim()) return;
    setIsLookingUp(true);
    setLookupError(null);
    setLookedUpPerson(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("lookup_user_by_email_for_temporary_grant", {
      p_institution_id: institutionId,
      p_email: email.trim(),
    });
    setIsLookingUp(false);
    if (error) {
      setLookupError(error.message);
      return;
    }
    const row = data?.[0];
    if (!row) {
      setLookupError("No Behaviour Hive account found for that email. They must sign up before they can be granted access.");
      return;
    }
    setLookedUpPerson({ userId: row.user_id, fullName: row.full_name ?? "Unnamed account" });
  }

  const targetUserId = pickMode === "existing" ? selectedUserId : lookedUpPerson?.userId ?? "";
  const targetName =
    pickMode === "existing"
      ? eligibleExisting.find((p) => p.userId === selectedUserId)?.fullName ?? ""
      : lookedUpPerson?.fullName ?? "";
  const canSubmit = Boolean(targetUserId) && Boolean(date) && reason.trim().length > 0;

  async function handleGrant() {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("grant_temporary_access", {
      p_class_id: classId,
      p_user_id: targetUserId,
      p_date: date,
      p_reason: reason.trim(),
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    reset();
    onGranted();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
        {mode === "principal" ? `Grant Cover for ${className}` : `Grant SNA Cover for ${className}`}
      </h2>

      {mode === "principal" && (
        <p className="mt-2 text-sm text-brand-neutral-black/70">
          They get SNA-level access for the day, regardless of who they&apos;re covering for -- a supply teacher never
          gets more than an SNA would see, even when covering a class teacher&apos;s absence.
        </p>
      )}

      <p className="mt-2 text-sm text-brand-neutral-black/70">
        Access starts at {formatTimeOfDay(startTime)} and ends at {formatTimeOfDay(cutoffTime)}. Anything unfinished
        cannot be completed afterwards.
      </p>

      {mode === "principal" && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setPickMode("existing")}
            className={`flex-1 rounded-xl border py-2 text-sm font-semibold ${
              pickMode === "existing" ? "border-brand-prussian-blue bg-brand-pastel-blue/10 text-brand-prussian-blue" : "border-black/10 text-brand-neutral-black/60"
            }`}
          >
            Existing staff
          </button>
          <button
            type="button"
            onClick={() => setPickMode("email")}
            className={`flex-1 rounded-xl border py-2 text-sm font-semibold ${
              pickMode === "email" ? "border-brand-prussian-blue bg-brand-pastel-blue/10 text-brand-prussian-blue" : "border-black/10 text-brand-neutral-black/60"
            }`}
          >
            New supply teacher
          </button>
        </div>
      )}

      {pickMode === "existing" ? (
        <div className="mt-4">
          <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
            {mode === "classTeacher" ? "SNA" : "Staff member"}
          </label>
          {eligibleExisting.length === 0 ? (
            <p className="rounded-xl border border-dashed border-black/10 bg-brand-off-white/40 p-3 text-sm text-brand-neutral-black/60">
              {mode === "classTeacher" ? "No active SNAs at this school to grant cover to." : "No active staff to choose from."}
            </p>
          ) : (
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-brand-neutral-black"
            >
              <option value="">Select…</option>
              {eligibleExisting.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.fullName}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : (
        <div className="mt-4">
          <p className="mb-2 text-sm text-brand-neutral-black/70">
            They must already have a Behaviour Hive account -- there&apos;s no way to invite someone by email here. If
            they haven&apos;t signed up yet, ask them to do that first.
          </p>
          <div className="flex gap-2">
            <div className="flex-1">
              <TextField
                label="Email address"
                id="grant-temp-access-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setLookedUpPerson(null);
                  setLookupError(null);
                }}
                placeholder="name@example.com"
              />
            </div>
            <Button type="button" onClick={handleLookup} disabled={isLookingUp || !email.trim()} className="!w-auto self-end px-4">
              {isLookingUp ? "Looking up…" : "Find"}
            </Button>
          </div>
          {lookupError && <p className="mt-2 text-sm text-brand-golden-brown">{lookupError}</p>}
          {lookedUpPerson && (
            <p className="mt-2 rounded-xl border border-black/10 bg-brand-pastel-blue/10 p-3 text-sm text-brand-neutral-black">
              Found: <span className="font-semibold">{lookedUpPerson.fullName}</span>
            </p>
          )}
        </div>
      )}

      <div className="mt-4">
        <TextField label="Date" id="grant-temp-access-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} min={todayLocalDateString()} />
      </div>

      <div className="mt-4">
        <Textarea
          label="Reason"
          id="grant-temp-access-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Covering an absence"
        />
      </div>

      {submitError && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {submitError}
        </p>
      )}

      <Button type="button" onClick={handleGrant} disabled={isSubmitting || !canSubmit} className="mt-4">
        {isSubmitting ? "Granting…" : targetName ? `Grant Access to ${targetName}` : "Grant Access"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
