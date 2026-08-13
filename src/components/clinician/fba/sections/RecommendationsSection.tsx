import { useState } from "react";
import { TextField } from "@/components/ui/TextField";
import { Textarea } from "@/components/ui/Textarea";
import { ReorderableList } from "../ReorderableList";
import { CalmCardSection } from "./recommendations/CalmCardSection";
import { useCalmCardsForFba } from "@/hooks/useCalmCardsForFba";
import { useStrategyTypes, type StrategyTypeOption } from "@/hooks/useStrategyTypes";
import { createClient } from "@/lib/supabase/client";
import { buildStrategyRef, type RecommendationGroup } from "@/lib/calmCards/types";
import type { FbaContentData, StrategyEntry } from "@/lib/fba/types";
import type { FbaSectionBodyProps } from "./types";

const GROUPS: { key: RecommendationGroup; label: string }[] = [
  { key: "recommendationsHome", label: "Home" },
  { key: "recommendationsSchool", label: "School" },
  { key: "recommendationsShared", label: "Shared" },
];

const SELECT_CLASS =
  "w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue disabled:opacity-50";

// Draft/in-progress path: a plain select, same save wiring as
// Title/Details (onChange updates local state, onBlur triggers the
// real save) -- no separate RPC needed here, this is ordinary
// content_data.
function StrategyTypeSelect({
  value,
  options,
  onChange,
  onBlur,
}: {
  value: string | undefined;
  options: StrategyTypeOption[];
  onChange: (next: string | undefined) => void;
  onBlur: () => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-brand-neutral-black">Strategy type (optional)</label>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        onBlur={onBlur}
        className={SELECT_CLASS}
      >
        <option value="">No strategy type</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Locked-FBA path (companion-layer rule, migration 0055): editing a
// StrategyEntry's tag on a completed FBA can't go through the normal
// content_data save (fba_reports' own UPDATE policy requires
// status <> 'completed') -- this calls update_locked_strategy_tag()
// directly instead, a SECURITY DEFINER RPC that touches ONLY the
// matching entry's strategyType key and nothing else in content_data.
// Fully self-contained (own optimistic state + rollback-on-error),
// same independence CalmCardSection's own editor already has from the
// page's save-status system.
function LockedStrategyTypeSelect({
  fbaId,
  group,
  entryId,
  value,
  options,
}: {
  fbaId: string;
  group: RecommendationGroup;
  entryId: string;
  value: string | undefined;
  options: StrategyTypeOption[];
}) {
  const [current, setCurrent] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: string | undefined) {
    const previous = current;
    setCurrent(next);
    setIsSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("update_locked_strategy_tag", {
      p_fba_id: fbaId,
      p_group: group,
      p_entry_id: entryId,
      p_strategy_type_id: next ?? null,
    });
    setIsSaving(false);
    if (rpcError) {
      console.error("Failed to update strategy tag:", rpcError);
      setError("Couldn't save this tag. Please try again.");
      setCurrent(previous);
    }
  }

  return (
    <div className="mt-2">
      <label className="mb-1 block text-xs font-semibold text-brand-neutral-black/60">Strategy type</label>
      <select
        value={current ?? ""}
        disabled={isSaving}
        onChange={(e) => handleChange(e.target.value || undefined)}
        className={SELECT_CLASS}
      >
        <option value="">No strategy type</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

// Calm Cards deliberately never see `readOnly` from this component --
// see CalmCardSection's own header comment. This is why fbaId is a
// separate required prop (like IndirectAssessmentSection's own extra
// prop) rather than threaded through FbaContentData: Calm Cards aren't
// FBA content, so they don't belong in `content` at all.
//
// isClinicianWorkspace gates the Calm Card authoring UI specifically --
// this component is ALSO reused by FbaSectionsReadOnly.tsx (the parent's
// FBA reader/print view, constraint 2's "no teacher surface" cousin: no
// PARENT authoring surface either). readOnly alone can't distinguish
// these two callers, since the clinician's own workspace also renders
// readOnly=true post-finalization (that's the retro-add case, where
// authoring must still show). The hook call itself stays unconditional
// (React hooks can't be conditional) -- it's harmless for the parent
// reader too, since fba_calm_cards' own RLS already limits what a parent
// caller gets back to their own child's published cards; only the JSX
// below is gated.
export function RecommendationsSection({
  fbaId,
  isClinicianWorkspace = false,
  content,
  onFieldChange,
  onFieldBlur,
  onStructuralChange,
  readOnly,
}: FbaSectionBodyProps & { fbaId: string; isClinicianWorkspace?: boolean }) {
  const { cards, createCard, updateCard, deleteCard } = useCalmCardsForFba(fbaId);
  const { options: strategyTypeOptions } = useStrategyTypes();

  // Chip source: this FBA's own triggers, setting events, and target
  // behaviours (constraint 1B) -- titles/names only, deduped, never
  // invented categories. Free-add in CalmCardSection covers anything
  // not already captured here.
  const availableTags = Array.from(
    new Set(
      [
        ...(content.triggers ?? []).map((t) => t.title),
        ...(content.settingEvents ?? []).map((s) => s.title),
        ...(content.targetBehaviours ?? []).map((tb) => tb.name),
      ].filter((tag): tag is string => Boolean(tag && tag.trim()))
    )
  );

  return (
    <div className="flex flex-col gap-8">
      {GROUPS.map((group) => {
        const entries = content[group.key] ?? [];

        return (
          <div key={group.key}>
            <p className="mb-2 font-heading text-base font-bold text-brand-neutral-black">
              {group.label}
            </p>
            <ReorderableList
              items={entries}
              onChange={(next) =>
                onStructuralChange({ ...content, [group.key]: next } as FbaContentData)
              }
              onAdd={() =>
                onStructuralChange({
                  ...content,
                  [group.key]: [...entries, { id: crypto.randomUUID(), title: "", details: [] }],
                } as FbaContentData)
              }
              addLabel="Add Strategy"
              emptyLabel={`No ${group.label.toLowerCase()} strategies added yet.`}
              readOnly={readOnly}
              renderItem={(entry, index) => {
                function updateEntry(patch: Partial<StrategyEntry>) {
                  const next = entries.map((e, i) => (i === index ? { ...e, ...patch } : e));
                  onFieldChange({ ...content, [group.key]: next } as FbaContentData);
                }

                const strategyRef = buildStrategyRef(group.key, entry.id);
                // Rendered in BOTH branches below, identically -- this is
                // the retro-add path (constraint 1B): a completed FBA's
                // read-only strategy list still gets the same Calm Card
                // affordance a draft's does, since CalmCardSection itself
                // never checks `readOnly`. Absent entirely (not even a
                // read-only display of it) when isClinicianWorkspace is
                // false -- see the component-level comment above.
                const calmCardSection = isClinicianWorkspace ? (
                  <CalmCardSection
                    strategyRef={strategyRef}
                    suggestedTitle={entry.title}
                    cards={cards}
                    availableTags={availableTags}
                    strategyTypeOptions={strategyTypeOptions}
                    linkedStrategyTypeId={entry.strategyType ?? null}
                    onCreate={createCard}
                    onUpdate={updateCard}
                    onDelete={deleteCard}
                  />
                ) : null;

                if (readOnly) {
                  return (
                    <div>
                      <p className="font-semibold text-brand-neutral-black">
                        {index + 1}. {entry.title || "Untitled strategy"}
                      </p>
                      {entry.details.length > 0 && (
                        <ul className="mt-1 list-disc pl-5 text-sm text-brand-neutral-black/70">
                          {entry.details.map((detail, i) => (
                            <li key={i}>{detail}</li>
                          ))}
                        </ul>
                      )}
                      {/* Companion-layer post-hoc tagging (migration
                          0055): allowed on a locked FBA -- it's metadata,
                          not the FBA's clinical content -- so this is the
                          one field in a readOnly strategy that stays
                          genuinely editable. Same isClinicianWorkspace
                          gate as calmCardSection: never shown to the
                          parent reader. */}
                      {isClinicianWorkspace && (
                        <LockedStrategyTypeSelect
                          fbaId={fbaId}
                          group={group.key}
                          entryId={entry.id}
                          value={entry.strategyType}
                          options={strategyTypeOptions}
                        />
                      )}
                      {calmCardSection}
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col gap-3">
                    <TextField
                      label="Title"
                      value={entry.title}
                      onChange={(e) => updateEntry({ title: e.target.value })}
                      onBlur={onFieldBlur}
                    />
                    <Textarea
                      label="Details (one per line)"
                      value={entry.details.join("\n")}
                      onChange={(e) => updateEntry({ details: e.target.value.split("\n") })}
                      onBlur={onFieldBlur}
                      rows={4}
                    />
                    <StrategyTypeSelect
                      value={entry.strategyType}
                      options={strategyTypeOptions}
                      onChange={(next) => updateEntry({ strategyType: next })}
                      onBlur={onFieldBlur}
                    />
                    {calmCardSection}
                  </div>
                );
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
