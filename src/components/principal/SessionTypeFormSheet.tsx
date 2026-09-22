"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { TextField } from "@/components/ui/TextField";

// Session types, fixed -> clinic-configurable catalogue (migration
// 0281) -- the director's own create/edit form. No RPC: session_types'
// own RLS write policy is already director-only "for all" (matching
// institution_tags exactly), so a direct table insert/update is the
// same posture the Tags page already uses for its own writes. Retiring
// is a separate, single-field update (is_active) driven from the list
// page itself, not this form.

export interface SessionTypeRow {
  id: string;
  name: string;
  description: string | null;
  location_mode: string;
  length_minutes: number;
  travel_before_minutes: number;
  travel_after_minutes: number;
  is_parent_bookable: boolean;
  is_active: boolean;
  location_details: string | null;
}

const LOCATION_MODES: { value: string; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "in_person", label: "In-person" },
  { value: "elsewhere", label: "Elsewhere" },
];

interface SessionTypeFormSheetProps {
  isOpen: boolean;
  institutionId: string;
  // null = creating a new type; a row = editing that one in place.
  existing: SessionTypeRow | null;
  onClose: () => void;
  onSaved: () => void;
}

export function SessionTypeFormSheet({ isOpen, institutionId, existing, onClose, onSaved }: SessionTypeFormSheetProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [locationMode, setLocationMode] = useState("online");
  const [lengthMinutes, setLengthMinutes] = useState("60");
  const [travelBeforeMinutes, setTravelBeforeMinutes] = useState("0");
  const [travelAfterMinutes, setTravelAfterMinutes] = useState("0");
  const [locationDetails, setLocationDetails] = useState("");
  const [isParentBookable, setIsParentBookable] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (existing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName(existing.name);
      setDescription(existing.description ?? "");
      setLocationMode(existing.location_mode);
      setLengthMinutes(String(existing.length_minutes));
      setTravelBeforeMinutes(String(existing.travel_before_minutes));
      setTravelAfterMinutes(String(existing.travel_after_minutes));
      setLocationDetails(existing.location_details ?? "");
      setIsParentBookable(existing.is_parent_bookable);
    } else {
      setName("");
      setDescription("");
      setLocationMode("online");
      setLengthMinutes("60");
      setTravelBeforeMinutes("0");
      setTravelAfterMinutes("0");
      setLocationDetails("");
      setIsParentBookable(true);
    }
    setSubmitError(null);
    // existing is a fresh object identity each time the parent's own
    // list reloads, so keying only on isOpen (the moment the sheet is
    // actually shown) avoids re-seeding mid-edit on an unrelated reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function close() {
    if (isSubmitting) return;
    onClose();
  }

  async function handleSave() {
    const trimmedName = name.trim();
    const length = Number.parseInt(lengthMinutes, 10);
    const travelBefore = Number.parseInt(travelBeforeMinutes, 10) || 0;
    const travelAfter = Number.parseInt(travelAfterMinutes, 10) || 0;
    if (!trimmedName) {
      setSubmitError("A name is required.");
      return;
    }
    if (!Number.isFinite(length) || length <= 0) {
      setSubmitError("Length must be a positive number of minutes.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const payload = {
      name: trimmedName,
      description: description.trim() || null,
      location_mode: locationMode,
      length_minutes: length,
      travel_before_minutes: travelBefore,
      travel_after_minutes: travelAfter,
      location_details: locationMode === "online" ? null : locationDetails.trim() || null,
      is_parent_bookable: isParentBookable,
    };
    const { error } = existing
      ? await supabase.from("session_types").update(payload).eq("id", existing.id)
      : await supabase.from("session_types").insert({ ...payload, institution_id: institutionId });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    onSaved();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
        {existing ? "Edit Session Type" : "New Session Type"}
      </h2>

      <div className="mt-4 flex flex-col gap-3">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="Description (shown to parents)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div>
          <p className="mb-1.5 text-sm font-semibold text-brand-neutral-black">Where it happens</p>
          <div className="flex flex-wrap gap-2">
            {LOCATION_MODES.map((mode) => {
              const isSelected = locationMode === mode.value;
              return (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => setLocationMode(mode.value)}
                  aria-pressed={isSelected}
                  className={`min-h-11 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                    isSelected
                      ? "border-brand-prussian-blue bg-brand-pastel-blue/40 text-brand-prussian-blue"
                      : "border-black/10 bg-white text-brand-neutral-black/60"
                  }`}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>
        </div>

        {locationMode !== "online" && (
          <TextField
            label="Location details (shown to parents)"
            value={locationDetails}
            onChange={(e) => setLocationDetails(e.target.value)}
            placeholder="e.g. At your home -- your clinician will come to you"
          />
        )}

        <TextField label="Length (minutes)" type="number" min={1} value={lengthMinutes} onChange={(e) => setLengthMinutes(e.target.value)} />

        <div className="flex gap-3">
          <div className="flex-1">
            <TextField
              label="Travel before (minutes)"
              type="number"
              min={0}
              value={travelBeforeMinutes}
              onChange={(e) => setTravelBeforeMinutes(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <TextField
              label="Travel after (minutes)"
              type="number"
              min={0}
              value={travelAfterMinutes}
              onChange={(e) => setTravelAfterMinutes(e.target.value)}
            />
          </div>
        </div>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={isParentBookable}
            onChange={(e) => setIsParentBookable(e.target.checked)}
            className="mt-1 h-5 w-5 flex-shrink-0"
          />
          <span className="text-sm text-brand-neutral-black/80">
            Parents can book this themselves. Leave unchecked for a session type staff arrange directly -- it stays
            in the catalogue but never appears in the parent&apos;s own booking picker.
          </span>
        </label>
      </div>

      {submitError && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {submitError}
        </p>
      )}

      <Button type="button" onClick={handleSave} disabled={isSubmitting} className="mt-4">
        {isSubmitting ? "Saving…" : "Save"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
