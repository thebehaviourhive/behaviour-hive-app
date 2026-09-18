"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useClinicalPlans } from "@/hooks/useClinicalPlans";
import { PLAN_TYPES, PLAN_TYPE_LABELS, type PlanType } from "@/lib/clinicalPlans";

// PRD 7 -- the Silo 2 placeholders' own Clinical File tab. Not "coming
// soon": a clinician picks a type, names it, and lands straight in the
// plan's own workspace (name/date/body/attachment) -- see migration
// 0244's own table comment for why this never locks.
export function ClinicalFilePlansTab({ passportId }: { passportId: string; childName: string }) {
  const router = useRouter();
  const { plans, loadError, reload, create } = useClinicalPlans(passportId);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<PlanType | null>(null);
  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function openPicker() {
    setSelectedType(null);
    setName("");
    setCreateError(null);
    setIsPickerOpen(true);
  }

  async function handleCreate() {
    if (!selectedType || !name.trim()) return;
    setIsCreating(true);
    setCreateError(null);
    const { id, error } = await create(selectedType, name.trim());
    setIsCreating(false);
    if (error || !id) {
      setCreateError(error ?? "Couldn't create this plan.");
      return;
    }
    router.push(`/clinician/plan/${id}`);
  }

  if (plans === null && !loadError) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (loadError) {
    return <InlineErrorState message={loadError} onRetry={reload} />;
  }

  const rows = plans ?? [];

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-sm text-black/50">
          No plans for this child yet -- crisis management, sensory diet, AAC/communication, care, or a Student
          Support Plan.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((plan) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => router.push(`/clinician/plan/${plan.id}`)}
              className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 text-left shadow-sm"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-brand-neutral-black">{plan.name}</p>
                <p className="text-xs text-brand-neutral-black/50">
                  {PLAN_TYPE_LABELS[plan.planType]} · {new Date(plan.planDate).toLocaleDateString("en-IE")}
                </p>
              </div>
              <span aria-hidden className="flex-shrink-0 text-black/30">
                &rsaquo;
              </span>
            </button>
          ))}
        </div>
      )}

      <Button type="button" onClick={openPicker}>
        + New Plan
      </Button>

      <BottomSheet isOpen={isPickerOpen} onClose={() => setIsPickerOpen(false)}>
        <h2 className="font-heading text-lg font-semibold text-brand-neutral-black">New plan</h2>

        <div className="mt-4 flex flex-col gap-2">
          {PLAN_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 rounded-xl border border-black/10 p-3">
              <input type="radio" name="plan-type" checked={selectedType === type} onChange={() => setSelectedType(type)} />
              <span className="text-sm text-brand-neutral-black">{PLAN_TYPE_LABELS[type]}</span>
            </label>
          ))}
        </div>

        {selectedType && (
          <div className="mt-4">
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder={PLAN_TYPE_LABELS[selectedType]} />
          </div>
        )}

        {createError && (
          <p role="alert" className="mt-2 text-sm font-medium text-red-600">
            {createError}
          </p>
        )}

        <div className="mt-5">
          <Button type="button" onClick={handleCreate} disabled={!selectedType || !name.trim() || isCreating}>
            {isCreating ? "Creating…" : "Create"}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
