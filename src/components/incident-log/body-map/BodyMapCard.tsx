"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { BodyFigureSvg } from "./BodyFigureSvg";
import { BodyMapMarker } from "./BodyMapMarker";
import { regionForMark, type BodyView } from "./bodyMapRegions";

// Body map for one injury record -- structure and copy follow the
// provided card-screen.html reference (matched, not copied verbatim).
// Placement isn't real until a type is confirmed: BodyFigureSvg's click
// handler only ever opens the picker sheet, nothing is drawn or written
// to the database until a type is chosen there. A stray tap that turns
// into a scroll never fires the click at all (ordinary DOM click
// semantics, not custom touch tracking -- ver every other tappable
// element already in this form), and a stray tap that DOES land just
// costs a sheet dismissal, not a false entry in a legal record.
//
// One marker style, always -- see BodyMapMarker's own comment. There is
// no separate "untyped" marker colour because there is no unconfirmed
// marker: the open sheet IS the untyped state.

export interface InjuryTypeOption {
  id: string;
  value: string;
}

interface BodyMark {
  id: string;
  view: BodyView;
  x: number;
  y: number;
  injuryTypeId: string;
  injuryTypeName: string;
}

interface BodyMapCardProps {
  injuryId: string;
  partyName: string;
  canEdit: boolean;
  injuryTypeOptions: InjuryTypeOption[];
}

export function BodyMapCard({ injuryId, partyName, canEdit, injuryTypeOptions }: BodyMapCardProps) {
  const [marks, setMarks] = useState<BodyMark[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingPlacement, setPendingPlacement] = useState<{ view: BodyView; x: number; y: number } | null>(null);
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
  const [isChangingType, setIsChangingType] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const nameByTypeId = new Map(injuryTypeOptions.map((t) => [t.id, t.value]));

  useEffect(() => {
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data, error: loadError } = await supabase
        .from("incident_body_marks")
        .select("id, view, x, y, injury_type_id")
        .eq("injury_id", injuryId)
        .order("created_at", { ascending: true });

      if (!isMounted) return;

      if (loadError) {
        setError(loadError.message);
        setIsLoading(false);
        return;
      }

      setMarks(
        (data ?? []).map((row) => ({
          id: row.id,
          view: row.view as BodyView,
          x: row.x,
          y: row.y,
          injuryTypeId: row.injury_type_id,
          injuryTypeName: nameByTypeId.get(row.injury_type_id) ?? "Unknown type",
        }))
      );
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injuryId]);

  function handlePlaceMark(view: BodyView, x: number, y: number) {
    if (!canEdit) return;
    setPendingPlacement({ view, x, y });
    setSelectedMarkId(null);
    setIsChangingType(false);
  }

  function handleSelectMark(markId: string) {
    if (!canEdit) return;
    setSelectedMarkId(markId);
    setPendingPlacement(null);
    setIsChangingType(false);
  }

  function closeSheet() {
    setPendingPlacement(null);
    setSelectedMarkId(null);
    setIsChangingType(false);
  }

  async function handleChooseType(injuryTypeId: string) {
    setIsSaving(true);
    setError(null);
    const supabase = createClient();
    const injuryTypeName = nameByTypeId.get(injuryTypeId) ?? "Unknown type";

    if (pendingPlacement) {
      const { data: inserted, error: insertError } = await supabase
        .from("incident_body_marks")
        .insert({
          injury_id: injuryId,
          view: pendingPlacement.view,
          x: pendingPlacement.x,
          y: pendingPlacement.y,
          injury_type_id: injuryTypeId,
        })
        .select("id")
        .single();

      setIsSaving(false);
      if (insertError) {
        setError(insertError.message);
        return;
      }
      setMarks((current) => [
        ...current,
        { id: inserted.id, view: pendingPlacement.view, x: pendingPlacement.x, y: pendingPlacement.y, injuryTypeId, injuryTypeName },
      ]);
      closeSheet();
      return;
    }

    if (selectedMarkId) {
      const { error: updateError } = await supabase
        .from("incident_body_marks")
        .update({ injury_type_id: injuryTypeId })
        .eq("id", selectedMarkId);

      setIsSaving(false);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setMarks((current) =>
        current.map((m) => (m.id === selectedMarkId ? { ...m, injuryTypeId, injuryTypeName } : m))
      );
      closeSheet();
    }
  }

  async function handleRemove() {
    if (!selectedMarkId) return;
    setIsSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("incident_body_marks").delete().eq("id", selectedMarkId);
    setIsSaving(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setMarks((current) => current.filter((m) => m.id !== selectedMarkId));
    closeSheet();
  }

  const selectedMark = marks.find((m) => m.id === selectedMarkId) ?? null;
  const isSheetOpen = Boolean(pendingPlacement || selectedMarkId);

  function markerNumber(markId: string): number {
    return marks.findIndex((m) => m.id === markId) + 1;
  }

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <h2 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.13em] text-brand-prussian-blue">Body map</h2>
      <div className="mb-3 inline-block rounded-full border border-brand-pastel-blue bg-[#EAF3F8] px-2.5 py-1 font-accent text-xs font-bold text-brand-prussian-blue">
        {partyName}
      </div>

      {isLoading ? (
        <div className="h-40 animate-pulse rounded-xl bg-brand-off-white/60" />
      ) : (
        <>
          <div className="flex gap-2.5">
            <div className="flex-1 rounded-xl border border-brand-pastel-blue bg-[#F4F9FC] p-1.5 pb-1 text-center">
              <BodyFigureSvg view="front" onPlaceMark={canEdit ? (x, y) => handlePlaceMark("front", x, y) : undefined}>
                {marks
                  .filter((m) => m.view === "front")
                  .map((m) => (
                    <BodyMapMarker
                      key={m.id}
                      xNorm={m.x}
                      yNorm={m.y}
                      number={markerNumber(m.id)}
                      isSelected={m.id === selectedMarkId}
                      onSelect={() => handleSelectMark(m.id)}
                    />
                  ))}
              </BodyFigureSvg>
              <p className="mt-0.5 font-accent text-[10px] font-bold tracking-[0.1em] text-[#33505E]">FRONT</p>
            </div>
            <div className="flex-1 rounded-xl border border-brand-pastel-blue bg-[#F4F9FC] p-1.5 pb-1 text-center">
              <BodyFigureSvg view="back" onPlaceMark={canEdit ? (x, y) => handlePlaceMark("back", x, y) : undefined}>
                {marks
                  .filter((m) => m.view === "back")
                  .map((m) => (
                    <BodyMapMarker
                      key={m.id}
                      xNorm={m.x}
                      yNorm={m.y}
                      number={markerNumber(m.id)}
                      isSelected={m.id === selectedMarkId}
                      onSelect={() => handleSelectMark(m.id)}
                    />
                  ))}
              </BodyFigureSvg>
              <p className="mt-0.5 font-accent text-[10px] font-bold tracking-[0.1em] text-[#33505E]">BACK</p>
            </div>
          </div>

          <p className="mt-2.5 text-center text-[10.5px] text-[#33505E]/85">Left and right are the child&apos;s own.</p>

          {marks.length > 0 && (
            <ul className="mt-2.5 list-none border-t border-black/[0.06] pt-2.5">
              {marks.map((m) => (
                <li key={m.id} className="mb-1.5 flex items-center gap-2 text-[12.5px] text-[#33505E]">
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-prussian-blue font-accent text-[11px] font-bold text-white">
                    {markerNumber(m.id)}
                  </span>
                  <span>
                    <b className="font-extrabold text-brand-prussian-blue">{m.injuryTypeName}</b> — {m.view},{" "}
                    {regionForMark(m.view, m.x, m.y)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p role="alert" className="mt-2 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          {canEdit && <p className="mt-2 text-center text-[11px] text-[#33505E]/70">Tap a figure to place a mark</p>}
        </>
      )}

      <BottomSheet isOpen={isSheetOpen} onClose={closeSheet}>
        {(pendingPlacement || isChangingType) && (
          <>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
              Injury type <span className="text-brand-golden-brown">Required</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {injuryTypeOptions.map((option) => {
                const isActive = isChangingType && selectedMark?.injuryTypeId === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleChooseType(option.id)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                      isActive
                        ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                        : "border-black/10 bg-white text-black/60 hover:bg-black/[0.02]"
                    }`}
                  >
                    {option.value}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {selectedMark && !isChangingType && (
          <>
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
              Marker {markerNumber(selectedMark.id)} · {selectedMark.injuryTypeName}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setIsChangingType(true)} disabled={isSaving}>
                Change type
              </Button>
              <Button type="button" onClick={handleRemove} disabled={isSaving} className="!bg-brand-golden-brown">
                {isSaving ? "Removing…" : "Remove"}
              </Button>
            </div>
          </>
        )}
      </BottomSheet>
    </div>
  );
}
