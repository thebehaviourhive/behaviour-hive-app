"use client";

import { useInstrumentItems } from "@/hooks/useInstrumentItems";
import { getCategoryMaxScores, scoreInstrumentByCategory } from "@/lib/fba/instrumentScoring";
import { resolveInstructionText } from "@/lib/fba/resolveInstruction";
import { INSTRUMENT_LABELS, RECIPIENT_ROLE_LABELS, type FbaInstrumentRequest } from "@/lib/fba/types";
import { HorizontalBarChart } from "../../charts/HorizontalBarChart";
import { NarrativeField } from "../../NarrativeField";

// The parent reader (Part C) reuses this card but has no server-side way
// to resolve a recipient's name (that join only exists inside the
// clinician-only get_fba_instrument_requests RPC) -- and doesn't
// necessarily need to show it, so the attribution fields are optional
// and the line is skippable via showAttribution.
type InstrumentResultRequest = Omit<FbaInstrumentRequest, "recipientName" | "recipientRole"> &
  Partial<Pick<FbaInstrumentRequest, "recipientName" | "recipientRole">>;

// Renders one completed instrument's results. QABF/MAS get a scored bar
// chart + raw totals table; the Open-Ended Interview gets its answers
// rendered as plain Q&A. Multiple completions of the same instrument
// (e.g. QABF from both parent and teacher) each get their own card,
// labelled by respondent -- the caller renders one of these per request.
export function InstrumentResultCard({
  request,
  childName,
  interpretation,
  onInterpretationChange,
  onInterpretationBlur,
  readOnly,
  showAttribution = true,
}: {
  request: InstrumentResultRequest;
  // Always the full name -- this is a clinical surface (clinician
  // results view, parent reader, PDF), never the teacher-shortened
  // form, regardless of which track is actually viewing it.
  childName: string;
  interpretation: string;
  onInterpretationChange: (value: string) => void;
  onInterpretationBlur: () => void;
  readOnly: boolean;
  showAttribution?: boolean;
}) {
  const { items, isLoading, loadError } = useInstrumentItems(
    request.instrumentType,
    Object.keys(request.responsesData)
  );
  const resolvedInstruction = resolveInstructionText(request.instruction, childName);

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="font-heading text-base font-bold text-brand-neutral-black">
        {INSTRUMENT_LABELS[request.instrumentType]}
      </p>
      {showAttribution && request.recipientName && request.recipientRole && (
        <p className="mb-3 text-sm text-brand-neutral-black/60">
          Completed by {request.recipientName} ({RECIPIENT_ROLE_LABELS[request.recipientRole]})
        </p>
      )}

      {resolvedInstruction && (
        <div className="mb-3 rounded-r-xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-3">
          <p className="text-sm leading-relaxed text-brand-neutral-black">{resolvedInstruction}</p>
        </div>
      )}

      {isLoading ? (
        <div className="h-24 animate-pulse rounded-2xl bg-brand-off-white" />
      ) : loadError || !items ? (
        <p className="text-sm text-red-600">{loadError ?? "Couldn't load this instrument."}</p>
      ) : request.instrumentType === "open_ended" ? (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <div key={item.id}>
              <p className="text-sm font-semibold text-brand-neutral-black">{item.text}</p>
              <p className="mt-1 text-sm text-brand-neutral-black/70">
                {request.responsesData[item.id]?.trim() || (
                  <span className="text-black/30">No answer given.</span>
                )}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <>
          <ScoredResults items={items} request={request} />
          <div className="mt-4">
            <NarrativeField
              label="Interpretation"
              value={interpretation}
              onChange={onInterpretationChange}
              onBlur={onInterpretationBlur}
              readOnly={readOnly}
              rows={4}
              placeholder="Clinical interpretation of these results…"
            />
          </div>
        </>
      )}
    </div>
  );
}

function ScoredResults({
  items,
  request,
}: {
  items: NonNullable<ReturnType<typeof useInstrumentItems>["items"]>;
  request: InstrumentResultRequest;
}) {
  const totals = scoreInstrumentByCategory(items, request.responsesData);
  const maxes = getCategoryMaxScores(items, request.responsesData);
  // From the item bank's own category order, not maxes' keys -- an
  // all-'X' category (every item excluded) never gets a maxes entry at
  // all, but it still needs to appear in the table as "Not applicable"
  // rather than silently vanishing.
  const categories = Array.from(new Set(items.map((item) => item.category).filter((c): c is string => Boolean(c))));
  // Never a zero bar for an all-'X' category -- omitted from the chart
  // entirely rather than rendered as an empty/zero-width bar that would
  // read as "scored zero", which is a different, false claim.
  const chartCategories = categories.filter((category) => (maxes[category] ?? 0) > 0);

  return (
    <div>
      <HorizontalBarChart
        bars={chartCategories.map((category) => ({
          label: category,
          value: totals[category] ?? 0,
          max: maxes[category],
        }))}
      />
      <div className="mt-4 overflow-hidden rounded-xl border border-black/5">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-brand-off-white/60 text-left">
              <th className="px-3 py-2 font-semibold text-brand-neutral-black/70">Category</th>
              <th className="px-3 py-2 text-right font-semibold text-brand-neutral-black/70">Total</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => {
              const isNotApplicable = !(category in maxes);
              return (
                <tr key={category} className="border-t border-black/5">
                  <td className="px-3 py-2 text-brand-neutral-black">{category}</td>
                  <td className="px-3 py-2 text-right font-semibold text-brand-neutral-black">
                    {isNotApplicable ? (
                      <span className="font-medium italic text-brand-neutral-black/50">Not applicable</span>
                    ) : (
                      `${totals[category] ?? 0} / ${maxes[category]}`
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
