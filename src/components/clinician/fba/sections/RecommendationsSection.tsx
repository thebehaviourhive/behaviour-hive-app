import { TextField } from "@/components/ui/TextField";
import { Textarea } from "@/components/ui/Textarea";
import { ReorderableList } from "../ReorderableList";
import type { FbaContentData, StrategyEntry } from "@/lib/fba/types";
import type { FbaSectionBodyProps } from "./types";

const GROUPS: { key: "recommendationsHome" | "recommendationsSchool" | "recommendationsShared"; label: string }[] = [
  { key: "recommendationsHome", label: "Home" },
  { key: "recommendationsSchool", label: "School" },
  { key: "recommendationsShared", label: "Shared" },
];

export function RecommendationsSection({
  content,
  onFieldChange,
  onFieldBlur,
  onStructuralChange,
  readOnly,
}: FbaSectionBodyProps) {
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
