"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useBspsForPassport } from "@/hooks/useBspsForPassport";
import type { BspRecord } from "@/lib/bsp/types";

interface CompletedFba {
  id: string;
  completedAt: string;
}

function statusLabel(status: BspRecord["status"]): string {
  if (status === "active") return "Active";
  if (status === "superseded") return "Superseded";
  return "Draft";
}

function statusClassName(status: BspRecord["status"]): string {
  if (status === "active") return "bg-brand-golden-brown/15 text-brand-golden-brown";
  if (status === "superseded") return "bg-black/5 text-brand-neutral-black/50";
  return "bg-brand-pastel-blue/30 text-brand-prussian-blue";
}

// PRD 7 Stage 4 -- the Clinical File's own BSP tab. Shows the child's
// current plan (draft or active), and its own history -- every
// superseded plan stays fully visible, permanently, since a school may
// have been acting on an older version for months.
export function ClinicalFileBspTab({ passportId }: { passportId: string; childName: string }) {
  const router = useRouter();
  const { plans, loadError, reload } = useBspsForPassport(passportId);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [completedFbas, setCompletedFbas] = useState<CompletedFba[] | null>(null);
  const [selectedFbaId, setSelectedFbaId] = useState<string | "none">("none");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadFbas = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("fba_reports")
      .select("id, completed_at")
      .eq("passport_id", passportId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false });
    setCompletedFbas(((data ?? []) as { id: string; completed_at: string }[]).map((r) => ({ id: r.id, completedAt: r.completed_at })));
  }, [passportId]);

  useEffect(() => {
    if (isPickerOpen && completedFbas === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadFbas();
    }
  }, [isPickerOpen, completedFbas, loadFbas]);

  async function handleCreate() {
    setIsCreating(true);
    setCreateError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_bsp", {
      p_passport_id: passportId,
      p_source_fba_id: selectedFbaId === "none" ? null : selectedFbaId,
    });
    setIsCreating(false);
    if (error) {
      setCreateError(error.message);
      return;
    }
    router.push(`/clinician/bsp/${data}`);
  }

  async function handleRevise(bspId: string) {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_bsp_revision", { p_bsp_id: bspId });
    if (error) {
      setCreateError(error.message);
      return;
    }
    router.push(`/clinician/bsp/${data}`);
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
  const active = rows.find((p) => p.status === "active");
  const draft = rows.find((p) => p.status === "draft");
  const history = rows.filter((p) => p.status === "superseded");

  return (
    <div className="flex flex-col gap-4">
      {draft && (
        <button
          type="button"
          onClick={() => router.push(`/clinician/bsp/${draft.id}`)}
          className="flex w-full items-center justify-between rounded-2xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-4 text-left shadow-sm"
        >
          <span className="text-sm font-semibold text-brand-neutral-black">
            Continue the plan in progress
          </span>
          <span aria-hidden className="text-black/30">
            &rsaquo;
          </span>
        </button>
      )}

      {active && (
        <button
          type="button"
          onClick={() => router.push(`/clinician/bsp/${active.id}`)}
          className="flex w-full flex-col gap-2 rounded-2xl border border-black/5 bg-white p-4 text-left shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClassName(active.status)}`}>
              {statusLabel(active.status)}
            </span>
            <span className="text-xs text-brand-neutral-black/50">
              Signed {active.signedAt ? new Date(active.signedAt).toLocaleDateString("en-IE") : "—"}
            </span>
          </div>
          <p className="text-sm text-brand-neutral-black/70">
            {active.targetBehaviours.length} target behaviour{active.targetBehaviours.length === 1 ? "" : "s"}
          </p>
          {!draft && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                handleRevise(active.id);
              }}
              className="mt-1 self-start rounded-full bg-brand-prussian-blue px-3 py-1.5 text-xs font-bold text-white"
            >
              Start a revision
            </span>
          )}
        </button>
      )}

      {!active && !draft && (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-sm text-black/50">
          No behaviour support plan for this child yet.
        </div>
      )}

      {!draft && (
        <Button type="button" variant={active ? "secondary" : "primary"} onClick={() => setIsPickerOpen(true)}>
          {active ? "Start a fresh plan" : "Start a Plan"}
        </Button>
      )}

      {createError && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {createError}
        </p>
      )}

      {history.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
            History
          </p>
          <div className="flex flex-col gap-2">
            {history.map((plan) => (
              <button
                key={plan.id}
                type="button"
                onClick={() => router.push(`/clinician/bsp/${plan.id}`)}
                className="flex items-center justify-between rounded-xl border border-black/10 bg-white p-3 text-left"
              >
                <span className="text-sm text-brand-neutral-black/70">
                  Signed {plan.signedAt ? new Date(plan.signedAt).toLocaleDateString("en-IE") : "—"}
                </span>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold text-brand-neutral-black/50">
                  Superseded
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <BottomSheet isOpen={isPickerOpen} onClose={() => setIsPickerOpen(false)}>
        <h2 className="font-heading text-lg font-semibold text-brand-neutral-black">
          Start a behaviour support plan
        </h2>
        <p className="mt-1 text-sm text-brand-neutral-black/60">
          Carry target behaviours, triggers and setting events over from a completed FBA, or start blank.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-black/10 p-3">
            <input
              type="radio"
              name="source-fba"
              checked={selectedFbaId === "none"}
              onChange={() => setSelectedFbaId("none")}
            />
            <span className="text-sm text-brand-neutral-black">Start blank</span>
          </label>
          {(completedFbas ?? []).map((fba) => (
            <label key={fba.id} className="flex items-center gap-2 rounded-xl border border-black/10 p-3">
              <input
                type="radio"
                name="source-fba"
                checked={selectedFbaId === fba.id}
                onChange={() => setSelectedFbaId(fba.id)}
              />
              <span className="text-sm text-brand-neutral-black">
                FBA completed {new Date(fba.completedAt).toLocaleDateString("en-IE")}
              </span>
            </label>
          ))}
          {completedFbas !== null && completedFbas.length === 0 && (
            <p className="text-xs text-brand-neutral-black/50">No completed FBA exists yet for this child.</p>
          )}
        </div>

        <div className="mt-5">
          <Button type="button" onClick={handleCreate} disabled={isCreating}>
            {isCreating ? "Creating…" : "Create"}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
