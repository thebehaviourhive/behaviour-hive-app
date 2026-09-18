"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useStrategyBank } from "@/hooks/useStrategyBank";
import { useBankAssets } from "@/hooks/useBankAssets";
import { ClinicianBottomNav } from "@/components/clinician/ClinicianBottomNav";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { Textarea } from "@/components/ui/Textarea";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { PLACEMENT_LABEL, type StrategyPlacement } from "@/lib/bsp/types";

const PLACEMENTS: StrategyPlacement[] = ["home", "school", "shared"];

// PRD 7 Stage 4 -- the clinic's own accumulated library. Section 2's
// own argument: build the bank first. Starts empty; this page is the
// mechanism, not the content -- Catherine (or any verified clinician
// at the clinic) fills it.
export default function StrategyBankPage() {
  const { isReady, user } = useRequireRole("clinician");
  const [institutionId, setInstitutionId] = useState<string | null | undefined>(undefined);
  const [isDirector, setIsDirector] = useState(false);

  const { strategies, loadError, reload, addStrategy, isSaving, saveError, curateStrategy } = useStrategyBank(institutionId ?? null);
  const { upload: uploadAsset, isUploading } = useBankAssets(institutionId ?? null);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [how, setHow] = useState("");
  const [scriptedLanguage, setScriptedLanguage] = useState("");
  const [materialsAndSetup, setMaterialsAndSetup] = useState("");
  const [placement, setPlacement] = useState<StrategyPlacement>("shared");
  const [caveat, setCaveat] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);

  const resolveContext = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();
    const { data: staff } = await supabase
      .from("institution_staff")
      .select("institution_id, role")
      .eq("user_id", user.id)
      .is("deactivated_at", null);

    const clinicRow = (staff ?? []).find((s) => s.role === "clinician" || s.role === "principal");
    setInstitutionId(clinicRow?.institution_id ?? null);
    setIsDirector((staff ?? []).some((s) => s.role === "principal"));
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resolveContext();
  }, [resolveContext]);

  function resetForm() {
    setTitle("");
    setWhy("");
    setHow("");
    setScriptedLanguage("");
    setMaterialsAndSetup("");
    setPlacement("shared");
    setCaveat("");
    setImageFile(null);
    setReferenceFile(null);
  }

  async function handleAdd() {
    let imageAssetId: string | null = null;
    let referenceAssetId: string | null = null;

    if (imageFile) {
      const { asset, error } = await uploadAsset(imageFile, `${title} — image`);
      if (error) return;
      imageAssetId = asset?.id ?? null;
    }
    if (referenceFile) {
      const { asset, error } = await uploadAsset(referenceFile, `${title} — reference`);
      if (error) return;
      referenceAssetId = asset?.id ?? null;
    }

    const { error } = await addStrategy({
      title,
      why,
      how,
      scriptedLanguage,
      materialsAndSetup,
      defaultPlacement: placement,
      caveat,
      imageAssetId,
      referenceAssetId,
    });
    if (!error) {
      resetForm();
      setIsAddOpen(false);
    }
  }

  if (!isReady || institutionId === undefined) {
    return null;
  }

  if (!institutionId) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-2 bg-brand-off-white/40 p-6 text-center">
        <p className="text-sm text-brand-neutral-black/60">
          The strategy bank belongs to a clinic. Independent practitioners have no clinic-wide library to build.
        </p>
        <ClinicianBottomNav />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center justify-between px-4 pt-8 pb-2">
        <h1 className="font-heading text-2xl font-semibold text-brand-prussian-blue">Strategy Bank</h1>
        <button type="button" onClick={() => setIsAddOpen(true)} className="rounded-full bg-brand-prussian-blue px-4 py-2 text-sm font-bold text-white">
          + Add
        </button>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 pt-3">
        {loadError && <InlineErrorState message={loadError} onRetry={reload} />}

        {(strategies ?? []).length === 0 && !loadError && (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-sm text-black/50">
            Your clinic&apos;s bank is empty. Add the first strategy.
          </div>
        )}

        {(strategies ?? []).map((s) => (
          <div key={s.id} className={`rounded-2xl border border-black/5 bg-white p-4 shadow-sm ${!s.isActive ? "opacity-50" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-brand-neutral-black">{s.title}</p>
                <span className="mt-1 inline-block rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold text-brand-neutral-black/60">
                  {PLACEMENT_LABEL[s.defaultPlacement]}
                </span>
                {!s.isActive && (
                  <span className="ml-2 inline-block rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-brand-neutral-black/50">
                    Retired
                  </span>
                )}
              </div>
              {isDirector && (
                <button
                  type="button"
                  onClick={() => curateStrategy(s.id, { isActive: !s.isActive })}
                  className="text-xs font-semibold text-brand-prussian-blue"
                >
                  {s.isActive ? "Retire" : "Restore"}
                </button>
              )}
            </div>
            <p className="mt-2 text-sm text-brand-neutral-black/70">{s.why}</p>
            <p className="mt-1 text-sm text-brand-neutral-black/70">{s.how}</p>
          </div>
        ))}
      </main>

      <BottomSheet isOpen={isAddOpen} onClose={() => setIsAddOpen(false)}>
        <h2 className="font-heading text-lg font-semibold text-brand-neutral-black">Add a strategy</h2>
        <div className="mt-4 flex max-h-[65vh] flex-col gap-3 overflow-y-auto">
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea label="Why" value={why} onChange={(e) => setWhy(e.target.value)} rows={2} />
          <Textarea label="How" value={how} onChange={(e) => setHow(e.target.value)} rows={2} />
          <Textarea
            label="Scripted language (optional)"
            value={scriptedLanguage}
            onChange={(e) => setScriptedLanguage(e.target.value)}
            rows={2}
          />
          <Textarea
            label="Materials & setup (optional)"
            value={materialsAndSetup}
            onChange={(e) => setMaterialsAndSetup(e.target.value)}
            rows={2}
          />
          <div>
            <p className="mb-1.5 text-sm font-semibold text-brand-neutral-black">Default placement</p>
            <div className="flex gap-2">
              {PLACEMENTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlacement(p)}
                  className={`flex-1 rounded-xl border py-2 text-sm font-semibold ${
                    placement === p ? "border-brand-prussian-blue bg-brand-prussian-blue text-white" : "border-black/10 bg-white"
                  }`}
                >
                  {PLACEMENT_LABEL[p]}
                </button>
              ))}
            </div>
          </div>
          <Textarea
            label="Caveat (optional — how this differs by setting)"
            value={caveat}
            onChange={(e) => setCaveat(e.target.value)}
            rows={2}
          />
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">Image (optional)</label>
            <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
              Reference tool (optional — e.g. a First-Then board)
            </label>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setReferenceFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
          </div>
          {saveError && (
            <p role="alert" className="text-sm font-medium text-red-600">
              {saveError}
            </p>
          )}
          <Button type="button" onClick={handleAdd} disabled={!title || !why || !how || isSaving || isUploading}>
            {isSaving || isUploading ? "Saving…" : "Add to bank"}
          </Button>
        </div>
      </BottomSheet>

      <ClinicianBottomNav />
    </div>
  );
}
