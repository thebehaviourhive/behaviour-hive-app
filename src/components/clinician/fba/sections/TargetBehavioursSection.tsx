import { TextField } from "@/components/ui/TextField";
import { Textarea } from "@/components/ui/Textarea";
import { ReorderableList } from "../ReorderableList";
import type { TargetBehaviourEntry } from "@/lib/fba/types";
import type { FbaSectionBodyProps } from "./types";

export function TargetBehavioursSection({
  content,
  onFieldChange,
  onFieldBlur,
  onStructuralChange,
  readOnly,
}: FbaSectionBodyProps) {
  const entries = content.targetBehaviours ?? [];

  function updateEntry(index: number, patch: Partial<TargetBehaviourEntry>) {
    const next = entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
    onFieldChange({ ...content, targetBehaviours: next });
  }

  function addEntry() {
    const next: TargetBehaviourEntry[] = [
      ...entries,
      { id: crypto.randomUUID(), name: "", operationalDefinition: "", howItPresents: "" },
    ];
    onStructuralChange({ ...content, targetBehaviours: next });
  }

  return (
    <ReorderableList
      items={entries}
      onChange={(next) => onStructuralChange({ ...content, targetBehaviours: next })}
      onAdd={addEntry}
      addLabel="Add Behaviour"
      emptyLabel="No target behaviours added yet."
      readOnly={readOnly}
      renderItem={(entry, index) =>
        readOnly ? (
          <div>
            <p className="font-semibold text-brand-neutral-black">
              {entry.name || "Untitled behaviour"}
            </p>
            {entry.operationalDefinition && (
              <p className="mt-1 text-sm text-brand-neutral-black/70">
                {entry.operationalDefinition}
              </p>
            )}
            {entry.howItPresents && (
              <p className="mt-1 text-sm text-brand-neutral-black/70">{entry.howItPresents}</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <TextField
              label="Behaviour name"
              value={entry.name}
              onChange={(e) => updateEntry(index, { name: e.target.value })}
              onBlur={onFieldBlur}
            />
            <Textarea
              label="Operational definition"
              value={entry.operationalDefinition}
              onChange={(e) => updateEntry(index, { operationalDefinition: e.target.value })}
              onBlur={onFieldBlur}
              rows={3}
            />
            <Textarea
              label="How it presents"
              value={entry.howItPresents}
              onChange={(e) => updateEntry(index, { howItPresents: e.target.value })}
              onBlur={onFieldBlur}
              rows={3}
            />
          </div>
        )
      }
    />
  );
}
