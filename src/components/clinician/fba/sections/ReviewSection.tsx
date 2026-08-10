import { FBA_SECTIONS, getSectionCompleteness } from "@/lib/fba/sections";
import { CompletenessDot } from "../CompletenessDot";
import { FbaNote } from "../FbaNote";
import type { FbaAflsData, FbaContentData } from "@/lib/fba/types";

// Section 14: read-only progress overview. Finalize (locking the report
// and unlocking parent visibility) is Stage 3 -- shown as a note here
// rather than a disabled button, so it doesn't read as broken.
export function ReviewSection({
  content,
  afls,
}: {
  content: FbaContentData;
  afls: FbaAflsData | null;
}) {
  const sections = FBA_SECTIONS.filter((section) => section.kind !== "review");
  const completeCount = sections.filter(
    (section) => getSectionCompleteness(section, content, afls) === "complete"
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <p className="font-heading text-lg font-bold text-brand-neutral-black">
          {completeCount} of {sections.length} sections complete
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {sections.map((section) => {
          const state = getSectionCompleteness(section, content, afls);
          return (
            <div
              key={section.slug}
              className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-3"
            >
              <CompletenessDot state={state} />
              <p className="text-sm font-medium text-brand-neutral-black">{section.title}</p>
            </div>
          );
        })}
      </div>

      <FbaNote>Completion arrives in the next update.</FbaNote>
    </div>
  );
}
