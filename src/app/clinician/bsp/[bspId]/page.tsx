"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useBsp } from "@/hooks/useBsp";
import { useStrategyBank } from "@/hooks/useStrategyBank";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { TextField } from "@/components/ui/TextField";
import { Textarea } from "@/components/ui/Textarea";
import { ReorderableList } from "@/components/clinician/fba/ReorderableList";
import { PLACEMENT_LABEL, type StrategyPlacement, type BspStrategy } from "@/lib/bsp/types";
import type { TargetBehaviourEntry, TriggerEntry, SettingEventEntry } from "@/lib/fba/types";

const PLACEMENTS: StrategyPlacement[] = ["home", "school", "shared"];

export default function BspWorkspacePage() {
  const params = useParams();
  const bspId = params.bspId as string;
  const router = useRouter();
  const { isReady } = useRequireRole("clinician");
  const {
    bsp,
    strategies,
    loadError,
    reload,
    saveFields,
    addFreshStrategy,
    addFromBank,
    updateStrategy,
    removeStrategy,
    sign,
    actionError,
    isSaving,
  } = useBsp(bspId);
  const { strategies: bank } = useStrategyBank(bsp?.institutionId ?? null);

  const [isBankPickerOpen, setIsBankPickerOpen] = useState(false);
  const [isFreshFormOpen, setIsFreshFormOpen] = useState(false);
  const [freshTitle, setFreshTitle] = useState("");
  const [freshWhy, setFreshWhy] = useState("");
  const [freshHow, setFreshHow] = useState("");
  const [freshPlacement, setFreshPlacement] = useState<StrategyPlacement>("shared");
  const [isSignConfirmOpen, setIsSignConfirmOpen] = useState(false);

  if (!isReady || (bsp === null && !loadError)) {
    return (
      <div className="flex min-h-full flex-1 flex-col gap-4 bg-brand-off-white/40 p-4">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (loadError || !bsp) {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 p-4">
        <InlineErrorState message={loadError ?? "This plan couldn't be found."} onRetry={reload} />
      </div>
    );
  }

  const readOnly = bsp.status !== "draft";

  async function handleAddFresh() {
    const { error } = await addFreshStrategy({ title: freshTitle, why: freshWhy, how: freshHow, placement: freshPlacement });
    if (!error) {
      setFreshTitle("");
      setFreshWhy("");
      setFreshHow("");
      setFreshPlacement("shared");
      setIsFreshFormOpen(false);
    }
  }

  async function handleSign() {
    const { error } = await sign();
    setIsSignConfirmOpen(false);
    if (!error) {
      router.push(`/clinician/bsp/${bspId}`);
    }
  }

  return (
    <main className="flex min-h-full flex-1 flex-col gap-6 bg-brand-off-white/40 px-4 py-8 lg:max-w-[66.6667%]">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => router.back()} className="text-sm font-semibold text-brand-prussian-blue">
          &lsaquo; Back
        </button>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            bsp.status === "active"
              ? "bg-brand-golden-brown/15 text-brand-golden-brown"
              : bsp.status === "superseded"
                ? "bg-black/5 text-brand-neutral-black/50"
                : "bg-brand-pastel-blue/30 text-brand-prussian-blue"
          }`}
        >
          {bsp.status === "active" ? "Active" : bsp.status === "superseded" ? "Superseded" : "Draft"}
        </span>
      </div>

      {readOnly && (
        <p className="rounded-xl bg-white p-3 text-sm text-brand-neutral-black/60">
          {bsp.status === "active"
            ? "This plan is signed and locked. Start a revision to change it."
            : "This plan was superseded by a later revision. It stays here exactly as it was signed."}
        </p>
      )}

      <section>
        <h2 className="mb-2 font-heading text-lg font-semibold text-brand-neutral-black">Target Behaviours</h2>
        <ReorderableList<TargetBehaviourEntry>
          items={bsp.targetBehaviours}
          onChange={(next) => saveFields({ targetBehaviours: next })}
          onAdd={() =>
            saveFields({
              targetBehaviours: [...bsp.targetBehaviours, { id: crypto.randomUUID(), name: "", operationalDefinition: "", howItPresents: "", function: "" }],
            })
          }
          addLabel="Add Behaviour"
          emptyLabel="No target behaviours yet."
          readOnly={readOnly}
          renderItem={(entry, index) =>
            readOnly ? (
              <div>
                <p className="font-semibold text-brand-neutral-black">{entry.name || "Untitled behaviour"}</p>
                {entry.operationalDefinition && <p className="mt-1 text-sm text-brand-neutral-black/70">{entry.operationalDefinition}</p>}
                {entry.function && <p className="mt-1 text-sm font-medium text-brand-prussian-blue">Function: {entry.function}</p>}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <TextField
                  label="Behaviour name"
                  value={entry.name}
                  onChange={(e) => {
                    const next = bsp.targetBehaviours.map((b, i) => (i === index ? { ...b, name: e.target.value } : b));
                    saveFields({ targetBehaviours: next });
                  }}
                />
                <Textarea
                  label="Operational definition"
                  value={entry.operationalDefinition}
                  onChange={(e) => {
                    const next = bsp.targetBehaviours.map((b, i) => (i === index ? { ...b, operationalDefinition: e.target.value } : b));
                    saveFields({ targetBehaviours: next });
                  }}
                  rows={2}
                />
                <Textarea
                  label="Function"
                  value={entry.function ?? ""}
                  onChange={(e) => {
                    const next = bsp.targetBehaviours.map((b, i) => (i === index ? { ...b, function: e.target.value } : b));
                    saveFields({ targetBehaviours: next });
                  }}
                  rows={2}
                />
              </div>
            )
          }
        />
      </section>

      <section>
        <h2 className="mb-2 font-heading text-lg font-semibold text-brand-neutral-black">Triggers</h2>
        <ReorderableList<TriggerEntry>
          items={bsp.triggers}
          onChange={(next) => saveFields({ triggers: next })}
          onAdd={() => saveFields({ triggers: [...bsp.triggers, { id: crypto.randomUUID(), title: "", description: "" }] })}
          addLabel="Add Trigger"
          emptyLabel="No triggers yet."
          readOnly={readOnly}
          renderItem={(entry, index) =>
            readOnly ? (
              <p className="text-sm text-brand-neutral-black">{entry.title}{entry.description ? ` — ${entry.description}` : ""}</p>
            ) : (
              <div className="flex flex-col gap-2">
                <TextField
                  label="Title"
                  value={entry.title}
                  onChange={(e) => {
                    const next = bsp.triggers.map((t, i) => (i === index ? { ...t, title: e.target.value } : t));
                    saveFields({ triggers: next });
                  }}
                />
                <Textarea
                  label="Description"
                  value={entry.description}
                  onChange={(e) => {
                    const next = bsp.triggers.map((t, i) => (i === index ? { ...t, description: e.target.value } : t));
                    saveFields({ triggers: next });
                  }}
                  rows={2}
                />
              </div>
            )
          }
        />
      </section>

      <section>
        <h2 className="mb-2 font-heading text-lg font-semibold text-brand-neutral-black">Setting Events</h2>
        <ReorderableList<SettingEventEntry>
          items={bsp.settingEvents}
          onChange={(next) => saveFields({ settingEvents: next })}
          onAdd={() => saveFields({ settingEvents: [...bsp.settingEvents, { id: crypto.randomUUID(), title: "", description: "" }] })}
          addLabel="Add Setting Event"
          emptyLabel="No setting events yet."
          readOnly={readOnly}
          renderItem={(entry, index) =>
            readOnly ? (
              <p className="text-sm text-brand-neutral-black">{entry.title}{entry.description ? ` — ${entry.description}` : ""}</p>
            ) : (
              <div className="flex flex-col gap-2">
                <TextField
                  label="Title"
                  value={entry.title}
                  onChange={(e) => {
                    const next = bsp.settingEvents.map((s, i) => (i === index ? { ...s, title: e.target.value } : s));
                    saveFields({ settingEvents: next });
                  }}
                />
                <Textarea
                  label="Description"
                  value={entry.description}
                  onChange={(e) => {
                    const next = bsp.settingEvents.map((s, i) => (i === index ? { ...s, description: e.target.value } : s));
                    saveFields({ settingEvents: next });
                  }}
                  rows={2}
                />
              </div>
            )
          }
        />
      </section>

      <section>
        <Textarea
          label="Precursors"
          value={bsp.precursors ?? ""}
          onChange={(e) => !readOnly && saveFields({ precursors: e.target.value })}
          onBlur={(e) => !readOnly && saveFields({ precursors: e.target.value })}
          readOnly={readOnly}
          rows={3}
        />
      </section>

      <section>
        {/* Fresh, BSP-only -- never carried from the FBA. */}
        <Textarea
          label="Current Frequency / Level of Behaviours"
          value={bsp.currentFrequency ?? ""}
          onChange={(e) => !readOnly && saveFields({ currentFrequency: e.target.value })}
          onBlur={(e) => !readOnly && saveFields({ currentFrequency: e.target.value })}
          readOnly={readOnly}
          rows={3}
          placeholder="A synthesis of how often and how intensely these behaviours currently occur."
        />
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold text-brand-neutral-black">Strategies</h2>
          {!readOnly && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsBankPickerOpen(true)}
                className="rounded-full bg-brand-prussian-blue px-3 py-1.5 text-xs font-bold text-white"
              >
                + From bank
              </button>
              <button
                type="button"
                onClick={() => setIsFreshFormOpen(true)}
                className="rounded-full border-2 border-brand-prussian-blue px-3 py-1.5 text-xs font-bold text-brand-prussian-blue"
              >
                + Fresh
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {(strategies ?? []).length === 0 && (
            <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center text-sm text-brand-neutral-black/70">
              No strategies added yet.
            </div>
          )}
          {(strategies ?? []).map((s) => (
            <StrategyCard key={s.id} strategy={s} readOnly={readOnly} onUpdate={updateStrategy} onRemove={removeStrategy} />
          ))}
        </div>
      </section>

      {actionError && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {actionError}
        </p>
      )}

      {!readOnly && (
        <Button type="button" onClick={() => setIsSignConfirmOpen(true)} disabled={isSaving}>
          Sign & Lock This Plan
        </Button>
      )}

      <BottomSheet isOpen={isSignConfirmOpen} onClose={() => setIsSignConfirmOpen(false)}>
        <h2 className="font-heading text-lg font-semibold text-brand-neutral-black">Sign this plan?</h2>
        <p className="mt-1 text-sm text-brand-neutral-black/60">
          Once signed, this plan is locked. Any further change is a new revision, not an edit — the current version
          stays exactly as signed.
        </p>
        <div className="mt-5 flex gap-3">
          <Button type="button" variant="secondary" onClick={() => setIsSignConfirmOpen(false)} className="flex-1">
            Cancel
          </Button>
          <Button type="button" onClick={handleSign} disabled={isSaving} className="flex-1">
            {isSaving ? "Signing…" : "Sign"}
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet isOpen={isBankPickerOpen} onClose={() => setIsBankPickerOpen(false)}>
        <h2 className="font-heading text-lg font-semibold text-brand-neutral-black">Add from the strategy bank</h2>
        <div className="mt-4 flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {(bank ?? []).filter((b) => b.isActive).length === 0 && (
            <p className="text-sm text-brand-neutral-black/50">
              No active strategies in your clinic&apos;s bank yet.
            </p>
          )}
          {(bank ?? [])
            .filter((b) => b.isActive)
            .map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={async () => {
                  const { error } = await addFromBank(b.id);
                  if (!error) setIsBankPickerOpen(false);
                }}
                className="rounded-xl border border-black/10 bg-white p-3 text-left"
              >
                <p className="text-sm font-semibold text-brand-neutral-black">{b.title}</p>
                <p className="mt-1 text-xs text-brand-neutral-black/60">{b.why}</p>
              </button>
            ))}
        </div>
      </BottomSheet>

      <BottomSheet isOpen={isFreshFormOpen} onClose={() => setIsFreshFormOpen(false)}>
        <h2 className="font-heading text-lg font-semibold text-brand-neutral-black">Add a fresh strategy</h2>
        <div className="mt-4 flex flex-col gap-3">
          <TextField label="Title" value={freshTitle} onChange={(e) => setFreshTitle(e.target.value)} />
          <Textarea label="Why" value={freshWhy} onChange={(e) => setFreshWhy(e.target.value)} rows={2} />
          <Textarea label="How" value={freshHow} onChange={(e) => setFreshHow(e.target.value)} rows={2} />
          <div className="flex gap-2">
            {PLACEMENTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setFreshPlacement(p)}
                className={`flex-1 rounded-xl border py-2 text-sm font-semibold ${
                  freshPlacement === p ? "border-brand-prussian-blue bg-brand-prussian-blue text-white" : "border-black/10 bg-white"
                }`}
              >
                {PLACEMENT_LABEL[p]}
              </button>
            ))}
          </div>
          <Button type="button" onClick={handleAddFresh} disabled={!freshTitle || !freshWhy || !freshHow}>
            Add
          </Button>
        </div>
      </BottomSheet>
    </main>
  );
}

function StrategyCard({
  strategy,
  readOnly,
  onUpdate,
  onRemove,
}: {
  strategy: BspStrategy;
  readOnly: boolean;
  onUpdate: (id: string, patch: Partial<{ title: string; why: string; how: string; placement: StrategyPlacement; caveat: string }>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="font-semibold text-brand-neutral-black">{strategy.title}</p>
          <span className="mt-1 inline-block rounded-full bg-black/5 px-2 py-0.5 text-xs font-semibold text-brand-neutral-black/60">
            {PLACEMENT_LABEL[strategy.placement]}
          </span>
        </div>
        {!readOnly && (
          <button type="button" onClick={() => onRemove(strategy.id)} className="text-xs font-semibold text-red-600">
            Remove
          </button>
        )}
      </div>
      <p className="mt-2 text-sm text-brand-neutral-black/70">{strategy.why}</p>
      <p className="mt-1 text-sm text-brand-neutral-black/70">{strategy.how}</p>
      {strategy.scriptedLanguage && <p className="mt-2 text-sm italic text-brand-neutral-black/60">&ldquo;{strategy.scriptedLanguage}&rdquo;</p>}
      {strategy.caveat && !readOnly && (
        <Textarea
          label="Caveat"
          value={strategy.caveat ?? ""}
          onChange={(e) => onUpdate(strategy.id, { caveat: e.target.value })}
          rows={2}
          className="mt-2"
        />
      )}
      {!readOnly && (
        <div className="mt-3 flex gap-2">
          {PLACEMENTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onUpdate(strategy.id, { placement: p })}
              className={`flex-1 rounded-xl border py-1.5 text-xs font-semibold ${
                strategy.placement === p ? "border-brand-prussian-blue bg-brand-prussian-blue text-white" : "border-black/10 bg-white"
              }`}
            >
              {PLACEMENT_LABEL[p]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
