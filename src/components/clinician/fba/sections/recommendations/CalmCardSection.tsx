"use client";

import { useState } from "react";
import {
  DOOR_TYPE_LABELS,
  MAX_STEPS,
  MIN_STEPS,
  STEP_CHAR_LIMIT,
  TITLE_CHAR_LIMIT,
  type CalmCard,
  type CalmCardDoorType,
} from "@/lib/calmCards/types";

// Calm Card authoring, per strategy. Deliberately has NO readOnly gate
// of its own -- unlike the surrounding RecommendationsSection content,
// Calm Cards stay editable regardless of the FBA's finalized status
// (migration 0053's whole reason for existing), so this component
// renders the same editable affordance whether the FBA is a draft or
// completed. That's what makes the retro-add path (constraint 1B) work
// with zero extra branching here -- the caller doesn't need to pass
// readOnly at all.
//
// Multiple cards per strategy are allowed: a strategy can carry more
// than one Calm Card (e.g. a prevention-door card and a separate
// deescalation-door card for the same strategy), so this lists every
// matching card for strategyRef -- each independently tappable to
// edit, delete, or publish/unpublish -- alongside an "Add Calm Card"
// button that stays visible whether or not cards already exist.
function ChipToggle({ label, isSelected, onClick }: { label: string; isSelected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
        isSelected
          ? "border border-brand-prussian-blue bg-brand-pastel-blue text-brand-prussian-blue"
          : "border border-transparent bg-brand-off-white text-brand-neutral-black"
      }`}
    >
      {label}
    </button>
  );
}

function CalmCardBadge({ card, onTap }: { card: CalmCard; onTap: () => void }) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="flex items-center gap-1.5 rounded-full bg-calm-pill px-3 py-1 text-xs font-semibold text-calm-ink"
    >
      <span aria-hidden>🩹</span>
      Calm Card {card.isPublished ? "· Published" : "· Draft"}
    </button>
  );
}

interface CalmCardEditorState {
  title: string;
  steps: string[];
  doorType: CalmCardDoorType;
  triggerTags: string[];
  freeTagInput: string;
}

function toEditorState(card: CalmCard | null, suggestedTitle: string): CalmCardEditorState {
  return {
    title: card?.title ?? suggestedTitle.slice(0, TITLE_CHAR_LIMIT),
    steps: card?.steps ?? ["", ""],
    doorType: card?.doorType ?? "prevention",
    triggerTags: card?.triggerTags ?? [],
    freeTagInput: "",
  };
}

export function CalmCardSection({
  strategyRef,
  suggestedTitle,
  cards,
  availableTags,
  onCreate,
  onUpdate,
  onDelete,
}: {
  strategyRef: string;
  suggestedTitle: string;
  cards: CalmCard[];
  availableTags: string[];
  onCreate: (input: {
    strategyRef: string;
    title: string;
    steps: string[];
    doorType: CalmCardDoorType;
    triggerTags: string[];
  }) => Promise<unknown>;
  onUpdate: (
    id: string,
    patch: Partial<{ title: string; steps: string[]; doorType: CalmCardDoorType; triggerTags: string[]; isPublished: boolean }>
  ) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}) {
  const strategyCards = cards.filter((c) => c.strategyRef === strategyRef);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorState, setEditorState] = useState<CalmCardEditorState>(() => toEditorState(null, suggestedTitle));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingCard = editingCardId ? strategyCards.find((c) => c.id === editingCardId) ?? null : null;

  function openEditorFor(card: CalmCard | null) {
    setEditingCardId(card?.id ?? null);
    setEditorState(toEditorState(card, suggestedTitle));
    setError(null);
    setIsEditorOpen(true);
  }

  function updateStep(index: number, value: string) {
    setEditorState((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === index ? value.slice(0, STEP_CHAR_LIMIT) : s)),
    }));
  }

  function addStep() {
    setEditorState((prev) => (prev.steps.length >= MAX_STEPS ? prev : { ...prev, steps: [...prev.steps, ""] }));
  }

  function removeStep(index: number) {
    setEditorState((prev) =>
      prev.steps.length <= MIN_STEPS ? prev : { ...prev, steps: prev.steps.filter((_, i) => i !== index) }
    );
  }

  function toggleTag(tag: string) {
    setEditorState((prev) => ({
      ...prev,
      triggerTags: prev.triggerTags.includes(tag)
        ? prev.triggerTags.filter((t) => t !== tag)
        : [...prev.triggerTags, tag],
    }));
  }

  function addFreeTag() {
    const value = editorState.freeTagInput.trim();
    if (!value || editorState.triggerTags.includes(value)) {
      setEditorState((prev) => ({ ...prev, freeTagInput: "" }));
      return;
    }
    setEditorState((prev) => ({ ...prev, triggerTags: [...prev.triggerTags, value], freeTagInput: "" }));
  }

  async function handleSave() {
    const trimmedSteps = editorState.steps.map((s) => s.trim()).filter(Boolean);
    if (!editorState.title.trim()) {
      setError("Give this card a title.");
      return;
    }
    if (trimmedSteps.length < MIN_STEPS) {
      setError(`Add at least ${MIN_STEPS} steps.`);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      if (existingCard) {
        await onUpdate(existingCard.id, {
          title: editorState.title.trim(),
          steps: trimmedSteps,
          doorType: editorState.doorType,
          triggerTags: editorState.triggerTags,
        });
      } else {
        await onCreate({
          strategyRef,
          title: editorState.title.trim(),
          steps: trimmedSteps,
          doorType: editorState.doorType,
          triggerTags: editorState.triggerTags,
        });
      }
      setIsEditorOpen(false);
    } catch (err) {
      console.error("Failed to save calm card:", err);
      setError("Couldn't save this Calm Card. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTogglePublish(card: CalmCard) {
    setIsSaving(true);
    setError(null);
    try {
      await onUpdate(card.id, { isPublished: !card.isPublished });
    } catch (err) {
      console.error("Failed to toggle publish:", err);
      setError("Couldn't update this Calm Card. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!existingCard) return;
    setIsSaving(true);
    setError(null);
    try {
      await onDelete(existingCard.id);
      setIsEditorOpen(false);
    } catch (err) {
      console.error("Failed to delete calm card:", err);
      setError("Couldn't delete this Calm Card. Please try again.");
      setIsSaving(false);
    }
  }

  return (
    <div className="mt-3 border-t border-black/5 pt-3">
      {!isEditorOpen && (
        <div className="flex flex-col gap-1.5">
          {strategyCards.map((card) => (
            <div key={card.id} className="flex items-center justify-between gap-2">
              <CalmCardBadge card={card} onTap={() => openEditorFor(card)} />
              <button
                type="button"
                onClick={() => handleTogglePublish(card)}
                disabled={isSaving}
                className="text-xs font-semibold text-brand-prussian-blue underline underline-offset-2 disabled:opacity-40"
              >
                {card.isPublished ? "Unpublish" : "Publish"}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => openEditorFor(null)}
            className="flex w-fit items-center gap-1.5 rounded-full border border-dashed border-calm-ink/40 px-3 py-1 text-xs font-semibold text-calm-ink"
          >
            <span aria-hidden>🩹</span> Add Calm Card
          </button>
        </div>
      )}

      {isEditorOpen && (
        <div className="flex flex-col gap-3 rounded-2xl border border-calm-pill bg-calm-pill/20 p-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-brand-neutral-black">Title</label>
            <input
              type="text"
              value={editorState.title}
              maxLength={TITLE_CHAR_LIMIT}
              onChange={(e) => setEditorState((prev) => ({ ...prev, title: e.target.value }))}
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black focus:border-calm-ink focus:outline-none focus:ring-2 focus:ring-calm-pill"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-brand-neutral-black">
              Steps ({MIN_STEPS}–{MAX_STEPS}, short and imperative -- e.g. &ldquo;Get low, speak softly&rdquo;)
            </label>
            <div className="flex flex-col gap-1.5">
              {editorState.steps.map((step, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={step}
                    maxLength={STEP_CHAR_LIMIT}
                    onChange={(e) => updateStep(i, e.target.value)}
                    placeholder={`Step ${i + 1}`}
                    className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black focus:border-calm-ink focus:outline-none focus:ring-2 focus:ring-calm-pill"
                  />
                  {editorState.steps.length > MIN_STEPS && (
                    <button
                      type="button"
                      aria-label="Remove step"
                      onClick={() => removeStep(i)}
                      className="flex-shrink-0 text-black/40"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {editorState.steps.length < MAX_STEPS && (
              <button type="button" onClick={addStep} className="mt-1.5 text-xs font-semibold text-brand-prussian-blue">
                + Add step
              </button>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-brand-neutral-black">
              When does this help? (author for the right moment)
            </label>
            <div className="flex gap-2">
              {(Object.keys(DOOR_TYPE_LABELS) as CalmCardDoorType[]).map((door) => (
                <button
                  key={door}
                  type="button"
                  onClick={() => setEditorState((prev) => ({ ...prev, doorType: door }))}
                  className={`flex-1 rounded-xl border py-2 text-xs font-semibold ${
                    editorState.doorType === door
                      ? "border-calm-ink bg-calm-pill text-calm-ink"
                      : "border-black/10 bg-white text-brand-neutral-black/60"
                  }`}
                >
                  {DOOR_TYPE_LABELS[door]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-brand-neutral-black">
              Trigger tags (this FBA&apos;s own triggers, setting events &amp; target behaviours -- or add your own)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {availableTags.map((tag) => (
                <ChipToggle key={tag} label={tag} isSelected={editorState.triggerTags.includes(tag)} onClick={() => toggleTag(tag)} />
              ))}
              {editorState.triggerTags
                .filter((t) => !availableTags.includes(t))
                .map((tag) => (
                  <ChipToggle key={tag} label={tag} isSelected onClick={() => toggleTag(tag)} />
                ))}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <input
                type="text"
                value={editorState.freeTagInput}
                onChange={(e) => setEditorState((prev) => ({ ...prev, freeTagInput: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addFreeTag();
                  }
                }}
                placeholder="Add a tag"
                className="flex-1 rounded-xl border border-black/10 bg-white px-3 py-1.5 text-sm text-brand-neutral-black focus:border-calm-ink focus:outline-none focus:ring-2 focus:ring-calm-pill"
              />
              <button type="button" onClick={addFreeTag} className="rounded-xl border border-black/10 bg-white px-3 text-sm font-semibold text-brand-prussian-blue">
                Add
              </button>
            </div>
          </div>

          {error && <p className="text-xs font-medium text-red-600">{error}</p>}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 rounded-xl bg-calm-ink py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {isSaving ? "Saving…" : "Save Calm Card"}
            </button>
            <button
              type="button"
              onClick={() => setIsEditorOpen(false)}
              disabled={isSaving}
              className="rounded-xl border border-black/10 px-3 py-2.5 text-sm font-semibold text-brand-neutral-black/60 disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
          {existingCard && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isSaving}
              className="text-xs font-semibold text-red-600 disabled:opacity-40"
            >
              Delete Calm Card
            </button>
          )}
        </div>
      )}
    </div>
  );
}
