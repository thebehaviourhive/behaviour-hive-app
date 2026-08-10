import { TextField } from "@/components/ui/TextField";
import { Textarea } from "@/components/ui/Textarea";
import { NarrativeField } from "../NarrativeField";
import { ReorderableList } from "../ReorderableList";
import type { SettingEventEntry, TriggerEntry } from "@/lib/fba/types";
import type { FbaSectionBodyProps } from "./types";

// Section 6: narrative co-varying/precursor text plus two structured
// repeatable lists. Triggers and Setting Events are stored as clean
// arrays deliberately -- Stage 3's passport_clinical_content extraction
// reads directly off these, per the brief.
export function TriggersSettingEventsSection({
  content,
  onFieldChange,
  onFieldBlur,
  onStructuralChange,
  readOnly,
}: FbaSectionBodyProps) {
  const triggers = content.triggers ?? [];
  const settingEvents = content.settingEvents ?? [];

  return (
    <div className="flex flex-col gap-6">
      <NarrativeField
        label="Co-Varying Behaviours"
        value={content.coVaryingBehaviours ?? ""}
        onChange={(next) => onFieldChange({ ...content, coVaryingBehaviours: next })}
        onBlur={onFieldBlur}
        readOnly={readOnly}
        rows={5}
      />
      <NarrativeField
        label="Precursors"
        value={content.precursors ?? ""}
        onChange={(next) => onFieldChange({ ...content, precursors: next })}
        onBlur={onFieldBlur}
        readOnly={readOnly}
        rows={5}
      />

      <div>
        <p className="mb-2 font-heading text-base font-bold text-brand-neutral-black">Triggers</p>
        <ReorderableList
          items={triggers}
          onChange={(next) => onStructuralChange({ ...content, triggers: next })}
          onAdd={() =>
            onStructuralChange({
              ...content,
              triggers: [...triggers, { id: crypto.randomUUID(), title: "", description: "" } as TriggerEntry],
            })
          }
          addLabel="Add Trigger"
          emptyLabel="No triggers recorded yet."
          readOnly={readOnly}
          renderItem={(entry, index) =>
            readOnly ? (
              <div>
                <p className="font-semibold text-brand-neutral-black">{entry.title || "Untitled"}</p>
                {entry.description && (
                  <p className="mt-1 text-sm text-brand-neutral-black/70">{entry.description}</p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <TextField
                  label="Title"
                  value={entry.title}
                  onChange={(e) => {
                    const next = triggers.map((t, i) => (i === index ? { ...t, title: e.target.value } : t));
                    onFieldChange({ ...content, triggers: next });
                  }}
                  onBlur={onFieldBlur}
                />
                <Textarea
                  label="Description"
                  value={entry.description}
                  onChange={(e) => {
                    const next = triggers.map((t, i) =>
                      i === index ? { ...t, description: e.target.value } : t
                    );
                    onFieldChange({ ...content, triggers: next });
                  }}
                  onBlur={onFieldBlur}
                  rows={3}
                />
              </div>
            )
          }
        />
      </div>

      <div>
        <p className="mb-2 font-heading text-base font-bold text-brand-neutral-black">
          Setting Events
        </p>
        <ReorderableList
          items={settingEvents}
          onChange={(next) => onStructuralChange({ ...content, settingEvents: next })}
          onAdd={() =>
            onStructuralChange({
              ...content,
              settingEvents: [
                ...settingEvents,
                { id: crypto.randomUUID(), title: "", description: "" } as SettingEventEntry,
              ],
            })
          }
          addLabel="Add Setting Event"
          emptyLabel="No setting events recorded yet."
          readOnly={readOnly}
          renderItem={(entry, index) =>
            readOnly ? (
              <div>
                <p className="font-semibold text-brand-neutral-black">{entry.title || "Untitled"}</p>
                {entry.description && (
                  <p className="mt-1 text-sm text-brand-neutral-black/70">{entry.description}</p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <TextField
                  label="Title"
                  value={entry.title}
                  onChange={(e) => {
                    const next = settingEvents.map((t, i) =>
                      i === index ? { ...t, title: e.target.value } : t
                    );
                    onFieldChange({ ...content, settingEvents: next });
                  }}
                  onBlur={onFieldBlur}
                />
                <Textarea
                  label="Description"
                  value={entry.description}
                  onChange={(e) => {
                    const next = settingEvents.map((t, i) =>
                      i === index ? { ...t, description: e.target.value } : t
                    );
                    onFieldChange({ ...content, settingEvents: next });
                  }}
                  onBlur={onFieldBlur}
                  rows={3}
                />
              </div>
            )
          }
        />
      </div>
    </div>
  );
}
