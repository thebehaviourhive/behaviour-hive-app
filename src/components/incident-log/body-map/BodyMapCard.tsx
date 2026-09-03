"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { BodyFigureSvg, type RegionTapInfo } from "./BodyFigureSvg";
import { BodyMapMarker } from "./BodyMapMarker";
import { regionWithSideLabel, type BodyView, type Side } from "./bodyMapRegions";
import { friendlyAccessLapsedMessage } from "@/lib/temporaryAccessTime";

// Body map for one injury record. Region and side are the fact --
// captured from the tapped SVG path's own data-region/data-side, never
// derived from where exactly the tap landed. x/y are kept only to place
// the numbered marker dot somewhere sensible within that region; they
// carry no meaning on their own any more.
//
// Placement isn't real until confirmed: tapping a region highlights it
// (a class toggle on the real path, not a re-render) and opens the
// sheet, but nothing is drawn or written to the database until the
// injury type -- and, for Bite, the skin-broken answer -- is chosen and
// Confirm is pressed. Dismissing the sheet at any point before that
// writes nothing, including the highlight, which clears on close.
//
// One marker style, always -- see BodyMapMarker's own comment.

export interface InjuryTypeOption {
  id: string;
  value: string;
}

export interface RegionOption {
  id: string;
  value: string;
}

interface BodyMark {
  id: string;
  view: BodyView;
  x: number;
  y: number;
  elementId: string;
  regionValue: string;
  side: Side;
  injuryTypeId: string;
  injuryTypeName: string;
  skinBroken: boolean | null;
}

interface BodyMapCardProps {
  injuryId: string;
  partyName: string;
  canEdit: boolean;
  injuryTypeOptions: InjuryTypeOption[];
  regionOptions: RegionOption[];
}

export function BodyMapCard({ injuryId, partyName, canEdit, injuryTypeOptions, regionOptions }: BodyMapCardProps) {
  const [marks, setMarks] = useState<BodyMark[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingTap, setPendingTap] = useState<
    { view: BodyView; elementId: string; region: string; side: Side; x: number; y: number } | null
  >(null);
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
  const [isChangingType, setIsChangingType] = useState(false);
  const [pendingTypeId, setPendingTypeId] = useState<string | null>(null);
  const [pendingSkinBroken, setPendingSkinBroken] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const nameByTypeId = new Map(injuryTypeOptions.map((t) => [t.id, t.value]));
  const idByRegionValue = new Map(regionOptions.map((r) => [r.value, r.id]));
  const biteTypeId = injuryTypeOptions.find((t) => t.value === "Bite")?.id ?? null;
  const pendingIsBite = pendingTypeId !== null && pendingTypeId === biteTypeId;

  useEffect(() => {
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data, error: loadError } = await supabase
        .from("incident_body_marks")
        .select("id, view, x, y, injury_type_id, region_id, side, skin_broken, incident_body_regions(value)")
        .eq("injury_id", injuryId);

      if (!isMounted) return;

      if (loadError) {
        setError(loadError.message);
        setIsLoading(false);
        return;
      }

      setMarks(
        (data ?? []).map((row) => {
          const regionRecord = row.incident_body_regions as unknown as { value: string } | { value: string }[] | null;
          const regionValue = (Array.isArray(regionRecord) ? regionRecord[0]?.value : regionRecord?.value) ?? "";
          return {
            id: row.id,
            view: row.view as BodyView,
            x: row.x,
            y: row.y,
            elementId: `${row.view}-${regionValue}`,
            regionValue,
            side: row.side as Side,
            injuryTypeId: row.injury_type_id,
            injuryTypeName: nameByTypeId.get(row.injury_type_id) ?? "Unknown type",
            skinBroken: row.skin_broken,
          };
        })
      );
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injuryId]);

  function handleRegionTap(view: BodyView, info: RegionTapInfo, xNorm: number, yNorm: number) {
    if (!canEdit) return;
    setPendingTap({ view, elementId: info.elementId, region: info.region, side: info.side, x: xNorm, y: yNorm });
    setSelectedMarkId(null);
    setIsChangingType(false);
    setPendingTypeId(null);
    setPendingSkinBroken(null);
  }

  function handleSelectMark(mark: BodyMark) {
    if (!canEdit) return;
    setSelectedMarkId(mark.id);
    setPendingTap(null);
    setIsChangingType(false);
    setPendingTypeId(null);
    setPendingSkinBroken(null);
  }

  function beginChangeType(mark: BodyMark) {
    setIsChangingType(true);
    setPendingTypeId(mark.injuryTypeId);
    setPendingSkinBroken(mark.skinBroken);
  }

  // Dismissing at any point -- backdrop tap, this function -- writes
  // nothing. The highlighted region (if any) clears along with it.
  function closeSheet() {
    setPendingTap(null);
    setSelectedMarkId(null);
    setIsChangingType(false);
    setPendingTypeId(null);
    setPendingSkinBroken(null);
  }

  async function handleConfirmNewMark() {
    if (!pendingTap || !pendingTypeId) return;
    const regionId = idByRegionValue.get(pendingTap.region);
    if (!regionId) {
      setError(`No seeded region matches "${pendingTap.region}" -- the vocabulary and the figure have drifted apart.`);
      return;
    }

    setIsSaving(true);
    setError(null);
    const supabase = createClient();
    const { data: inserted, error: insertError } = await supabase
      .from("incident_body_marks")
      .insert({
        injury_id: injuryId,
        view: pendingTap.view,
        x: pendingTap.x,
        y: pendingTap.y,
        region_id: regionId,
        side: pendingTap.side,
        injury_type_id: pendingTypeId,
        skin_broken: pendingIsBite ? pendingSkinBroken : null,
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
      {
        id: inserted.id,
        view: pendingTap.view,
        x: pendingTap.x,
        y: pendingTap.y,
        elementId: pendingTap.elementId,
        regionValue: pendingTap.region,
        side: pendingTap.side,
        injuryTypeId: pendingTypeId,
        injuryTypeName: nameByTypeId.get(pendingTypeId) ?? "Unknown type",
        skinBroken: pendingIsBite ? pendingSkinBroken : null,
      },
    ]);
    closeSheet();
  }

  async function handleConfirmTypeChange() {
    if (!selectedMarkId || !pendingTypeId) return;
    setIsSaving(true);
    setError(null);
    const supabase = createClient();
    // Changing away from Bite clears skin_broken in the same write --
    // catching the inconsistency at the point of change, not just
    // waiting for 0083's sign-off check to name it later.
    const skinBrokenValue = pendingIsBite ? pendingSkinBroken : null;
    // Bug report follow-up -- rows-affected check, single known row.
    const { data, error: updateError } = await supabase
      .from("incident_body_marks")
      .update({ injury_type_id: pendingTypeId, skin_broken: skinBrokenValue })
      .eq("id", selectedMarkId)
      .select("id");

    setIsSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    if (!data || data.length === 0) {
      setError(friendlyAccessLapsedMessage("This change"));
      return;
    }
    setMarks((current) =>
      current.map((m) =>
        m.id === selectedMarkId
          ? { ...m, injuryTypeId: pendingTypeId, injuryTypeName: nameByTypeId.get(pendingTypeId) ?? "Unknown type", skinBroken: skinBrokenValue }
          : m
      )
    );
    closeSheet();
  }

  async function handleRemove() {
    if (!selectedMarkId) return;
    setIsSaving(true);
    setError(null);
    const supabase = createClient();
    // Bug report follow-up -- rows-affected check, single known row.
    const { data, error: deleteError } = await supabase
      .from("incident_body_marks")
      .delete()
      .eq("id", selectedMarkId)
      .select("id");
    setIsSaving(false);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    if (!data || data.length === 0) {
      setError(friendlyAccessLapsedMessage("This removal"));
      return;
    }
    setMarks((current) => current.filter((m) => m.id !== selectedMarkId));
    closeSheet();
  }

  const selectedMark = marks.find((m) => m.id === selectedMarkId) ?? null;
  const isSheetOpen = Boolean(pendingTap || selectedMarkId);
  const highlightedElementId = pendingTap?.elementId ?? null;

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
              <BodyFigureSvg
                view="front"
                selectedElementId={pendingTap?.view === "front" ? highlightedElementId : null}
                onRegionTap={canEdit ? (info, x, y) => handleRegionTap("front", info, x, y) : undefined}
              >
                {marks
                  .filter((m) => m.view === "front")
                  .map((m) => (
                    <BodyMapMarker
                      key={m.id}
                      xNorm={m.x}
                      yNorm={m.y}
                      number={markerNumber(m.id)}
                      isSelected={m.id === selectedMarkId}
                      onSelect={() => handleSelectMark(m)}
                    />
                  ))}
              </BodyFigureSvg>
              <p className="mt-0.5 font-accent text-[10px] font-bold tracking-[0.1em] text-[#33505E]">FRONT</p>
            </div>
            <div className="flex-1 rounded-xl border border-brand-pastel-blue bg-[#F4F9FC] p-1.5 pb-1 text-center">
              <BodyFigureSvg
                view="back"
                selectedElementId={pendingTap?.view === "back" ? highlightedElementId : null}
                onRegionTap={canEdit ? (info, x, y) => handleRegionTap("back", info, x, y) : undefined}
              >
                {marks
                  .filter((m) => m.view === "back")
                  .map((m) => (
                    <BodyMapMarker
                      key={m.id}
                      xNorm={m.x}
                      yNorm={m.y}
                      number={markerNumber(m.id)}
                      isSelected={m.id === selectedMarkId}
                      onSelect={() => handleSelectMark(m)}
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
                    {regionWithSideLabel(m.regionValue, m.side)}
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

          {canEdit && <p className="mt-2 text-center text-[11px] text-[#33505E]/70">Tap a region to place a mark</p>}
        </>
      )}

      <BottomSheet isOpen={isSheetOpen} onClose={closeSheet}>
        {pendingTap && (
          <>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
              {regionWithSideLabel(pendingTap.region, pendingTap.side)}
            </p>
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
              Injury type <span className="text-brand-golden-brown">Required</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {injuryTypeOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setPendingTypeId(option.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    pendingTypeId === option.id
                      ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                      : "border-black/10 bg-white text-black/60 hover:bg-black/[0.02]"
                  }`}
                >
                  {option.value}
                </button>
              ))}
            </div>

            {pendingIsBite && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  Skin broken?
                </p>
                <div className="flex gap-2">
                  {(["yes", "no"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setPendingSkinBroken(v === "yes")}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        (pendingSkinBroken === true && v === "yes") || (pendingSkinBroken === false && v === "no")
                          ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                          : "border-black/10 bg-white text-black/60 hover:bg-black/[0.02]"
                      }`}
                    >
                      {v === "yes" ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4">
              <Button type="button" onClick={handleConfirmNewMark} disabled={!pendingTypeId || isSaving}>
                {isSaving ? "Saving…" : "Confirm"}
              </Button>
            </div>
          </>
        )}

        {isChangingType && selectedMark && (
          <>
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
              Injury type <span className="text-brand-golden-brown">Required</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {injuryTypeOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setPendingTypeId(option.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    pendingTypeId === option.id
                      ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                      : "border-black/10 bg-white text-black/60 hover:bg-black/[0.02]"
                  }`}
                >
                  {option.value}
                </button>
              ))}
            </div>

            {pendingIsBite && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  Skin broken?
                </p>
                <div className="flex gap-2">
                  {(["yes", "no"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setPendingSkinBroken(v === "yes")}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        (pendingSkinBroken === true && v === "yes") || (pendingSkinBroken === false && v === "no")
                          ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                          : "border-black/10 bg-white text-black/60 hover:bg-black/[0.02]"
                      }`}
                    >
                      {v === "yes" ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4">
              <Button type="button" onClick={handleConfirmTypeChange} disabled={!pendingTypeId || isSaving}>
                {isSaving ? "Saving…" : "Update"}
              </Button>
            </div>
          </>
        )}

        {selectedMark && !isChangingType && (
          <>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
              Marker {markerNumber(selectedMark.id)} · {regionWithSideLabel(selectedMark.regionValue, selectedMark.side)}
            </p>
            <p className="mb-3 text-sm font-semibold text-brand-neutral-black">
              {selectedMark.injuryTypeName}
              {selectedMark.injuryTypeName === "Bite" &&
                (selectedMark.skinBroken === null
                  ? " (skin broken: not recorded)"
                  : selectedMark.skinBroken
                    ? " (skin broken)"
                    : " (skin not broken)")}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => beginChangeType(selectedMark)} disabled={isSaving}>
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
