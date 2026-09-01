"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// PRD 4, Stage 5 -- incident_locations has had a real, working principal
// insert/update RLS policy since 0068 ("the brief is explicit that free
// text isn't acceptable there and a school must be able to edit its own
// list") but no client ever called it; this is that UI's first build,
// not a reskin. A flat list of strings, not an entity with a detail
// view, so it sits inline in the Routine Controls card rather than as a
// sheet or a Stage-4-style split pane -- there's nothing to drill into.
//
// Global default rows (institution_id null, e.g. "Classroom") show
// alongside the school's own additions so a principal can see what
// already exists before adding a near-duplicate, but only the school's
// own rows carry a Remove action -- the write policy itself refuses
// institution_id is null, so a global row could never be removed here
// even by accident.
//
// Remove is a soft-delete (is_active = false), not a hard delete -- by
// original design (0068's own comment: "is_active (not delete) is how a
// school 'removes' an option... deactivating just stops it appearing as
// a choice for NEW incidents while every existing one keeps rendering
// exactly what was selected at the time"). Confirmed live: the
// new-incident picker filters is_active = true; nothing that reads a
// past incident's location filters on it at all. So there is no "in
// use, refuse to remove" case to build -- removing never breaks a past
// record, by the schema's own construction, not by a check added here.
//
// No unique constraint exists on (institution_id, value) today, so an
// exact-duplicate insert would otherwise succeed silently (never a
// constraint error to catch) -- checked client-side instead, case- and
// whitespace-insensitively, against every currently visible value
// (global and the school's own), before ever calling insert.

interface LocationRow {
  id: string;
  institution_id: string | null;
  value: string;
}

export function IncidentLocationsCard({ institutionId }: { institutionId: string | null }) {
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newValue, setNewValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!institutionId) return;
    setIsLoading(true);
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("incident_locations")
      .select("id, institution_id, value")
      .or(`institution_id.is.null,institution_id.eq.${institutionId}`)
      .eq("is_active", true)
      .order("value", { ascending: true });
    if (!loadError) {
      setLocations((data ?? []) as LocationRow[]);
    }
    setIsLoading(false);
  }, [institutionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleAdd() {
    if (!institutionId) return;
    const trimmed = newValue.trim();
    if (!trimmed) return;
    setError(null);

    const isDuplicate = locations.some((loc) => loc.value.trim().toLowerCase() === trimmed.toLowerCase());
    if (isDuplicate) {
      setError("This location already exists.");
      return;
    }

    setIsAdding(true);
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from("incident_locations")
      .insert({ institution_id: institutionId, value: trimmed })
      .select("id, institution_id, value")
      .single();
    setIsAdding(false);

    if (insertError || !data) {
      setError("Could not add that location. Try again.");
      return;
    }
    setLocations((prev) => [...prev, data as LocationRow].sort((a, b) => a.value.localeCompare(b.value)));
    setNewValue("");
  }

  async function handleRemove(row: LocationRow) {
    setError(null);
    setRemovingId(row.id);
    const supabase = createClient();
    const { data, error: updateError } = await supabase
      .from("incident_locations")
      .update({ is_active: false })
      .eq("id", row.id)
      .select("id")
      .single();
    setRemovingId(null);

    // RLS on UPDATE silently filters rather than erroring -- an empty
    // result here (no thrown error, but no row back either) means the
    // policy refused the write, not that it silently no-op'd correctly.
    if (updateError || !data) {
      setError("Could not remove that location. Try again.");
      return;
    }
    setLocations((prev) => prev.filter((loc) => loc.id !== row.id));
  }

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="font-sans text-body font-semibold text-brand-neutral-black">Incident locations</p>
      <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/50">
        Shown when staff record where an incident happened. Removing one only affects new incidents -- past records
        keep what was selected at the time.
      </p>

      {isLoading ? (
        <div className="mt-3 flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[120px] w-full animate-pulse rounded-xl bg-brand-off-white/60" />
          ))}
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-2">
            {locations.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between rounded-xl border border-black/5 bg-brand-off-white/40 px-3.5 py-2.5"
              >
                <span className="font-sans text-body text-brand-neutral-black">{row.value}</span>
                {row.institution_id ? (
                  <button
                    type="button"
                    onClick={() => handleRemove(row)}
                    disabled={removingId === row.id}
                    className="flex-shrink-0 font-sans text-eyebrow font-semibold text-brand-prussian-blue disabled:opacity-50"
                  >
                    {removingId === row.id ? "Removing…" : "Remove"}
                  </button>
                ) : (
                  <span className="flex-shrink-0 font-sans text-eyebrow text-brand-neutral-black/40">Default</span>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              placeholder="e.g. Sensory Room"
              className="w-full flex-1 rounded-xl border border-black/10 bg-white px-4 py-2.5 font-sans text-body text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={isAdding || !newValue.trim()}
              className="flex-shrink-0 rounded-xl bg-brand-prussian-blue px-4 py-2.5 font-sans text-body font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAdding ? "Adding…" : "Add"}
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-2 font-sans text-eyebrow font-medium text-brand-golden-brown">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
