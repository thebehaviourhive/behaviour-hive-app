"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SavedStateIndicator } from "@/components/clinician/fba/SavedStateIndicator";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { useAssessment, type SubscaleTotal } from "@/hooks/useAssessment";
import { AttachmentsSection } from "@/components/clinician/assessments/AttachmentsSection";

const RESPONDENT_OPTIONS: { value: "parent" | "school_staff" | "interview"; label: string }[] = [
  { value: "parent", label: "Sent to parent" },
  { value: "school_staff", label: "Sent to school staff" },
  { value: "interview", label: "Interview" },
];

// PRD 7 Stage 1 -- the response sheet. Per section 13a: numbered rows
// and a response scale, NO ITEM TEXT -- this component never receives
// or renders anything an instrument's own paper protocol would call an
// item. It renders a plain 1..itemCount row list and, per row, the
// instrument's own response_scale as tap options (mirroring
// AflsSection's own tap-to-score interface stylistically, since both
// are "read the paper, tap the answer" -- not because either reproduces
// what's on the paper). "Doesn't apply" markers, exclusion-aware
// scoring, subscale mapping -- none of that lives here. The clinician
// enters SUBSCALE TOTALS directly, free-form (their own label, their
// own number, from the paper's own scoring key) -- the app never infers
// or computes them, and never even suggests what the subscale names
// might be.
//
// LOCAL DRAFT STATE FOR responses/subscaleTotals, NOT read-modify-write
// off `assessment` directly -- found live during deployed verification:
// two sibling edits in quick succession (e.g. typing a subscale label
// then immediately its total) can each read `assessment.subscaleTotals`
// before the FIRST edit's own round trip has updated it, so the second
// save silently overwrites the first. Local state updates synchronously
// on every edit, independent of the network round trip, so the second
// edit's own patch is always built from the first edit's own latest
// value -- the same reason SessionNoteEditor keeps local draft state
// rather than reading straight off the hook's own (round-trip-delayed)
// object.
export function AssessmentResponseSheetEditor({
  assessmentId,
  passportId,
}: {
  assessmentId: string;
  passportId: string;
}) {
  const router = useRouter();
  const { assessment, isLoading, loadError, reload, saveField, saveStatus, saveError, complete } =
    useAssessment(assessmentId);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const [draftResponses, setDraftResponses] = useState<Record<string, string>>({});
  const [draftSubscaleTotals, setDraftSubscaleTotals] = useState<SubscaleTotal[]>([]);

  // Seeds local draft state from the loaded assessment exactly once --
  // same reasoning as SessionNoteEditor's own hasSeededRef: saveField()
  // returns a new assessment object on every successful save, which
  // would otherwise re-fire a naive effect and stomp an in-progress
  // edit made in the gap between kicking a save off and it resolving.
  const hasSeededRef = useRef(false);
  useEffect(() => {
    if (assessment && !hasSeededRef.current) {
      hasSeededRef.current = true;
      setDraftResponses(assessment.responses);
      setDraftSubscaleTotals(assessment.subscaleTotals);
    }
  }, [assessment]);

  async function handleComplete() {
    setIsCompleting(true);
    setCompleteError(null);
    const { error } = await complete();
    setIsCompleting(false);
    if (error) setCompleteError(error);
  }

  function handleRespondentPick(value: "parent" | "school_staff" | "interview") {
    saveField({ respondentType: value });
  }

  function handleAnswerTap(rowNumber: number, value: string) {
    const next = { ...draftResponses, [String(rowNumber)]: value };
    setDraftResponses(next);
    saveField({ responses: next });
  }

  function handleAddSubscaleTotal() {
    const next = [...draftSubscaleTotals, { label: "", total: "" }];
    setDraftSubscaleTotals(next);
    saveField({ subscaleTotals: next });
  }

  function handleSubscaleTotalChange(index: number, patch: Partial<SubscaleTotal>) {
    const next = draftSubscaleTotals.map((row, i) => (i === index ? { ...row, ...patch } : row));
    setDraftSubscaleTotals(next);
    saveField({ subscaleTotals: next });
  }

  function handleRemoveSubscaleTotal(index: number) {
    const next = draftSubscaleTotals.filter((_, i) => i !== index);
    setDraftSubscaleTotals(next);
    saveField({ subscaleTotals: next });
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 px-4 pt-4">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
        <div className="h-64 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="px-4 pt-4">
        <InlineErrorState message={loadError} onRetry={reload} />
      </div>
    );
  }

  if (!assessment) {
    return (
      <div className="px-4 pt-4">
        <InlineErrorState message="This assessment couldn't be found." onRetry={reload} />
      </div>
    );
  }

  const isLocked = !!assessment.completedAt;
  const rowNumbers = Array.from({ length: assessment.instrumentItemCount ?? 0 }, (_, i) => i + 1);
  const scale = assessment.instrumentResponseScale ?? [];

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-black/5 bg-brand-off-white/95 px-4 pt-6 pb-4 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => router.push(`/clinician/passport/${passportId}?tab=assessments`)}
          aria-label="Back to assessments"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">
            {assessment.instrumentName} · Response sheet
          </p>
          <h1 className="truncate font-heading text-lg font-bold text-brand-prussian-blue">
            {isLocked ? "Completed" : "In progress"}
          </h1>
        </div>
        {!isLocked && (
          <div className="flex-shrink-0">
            <SavedStateIndicator
              status={saveStatus}
              isDirty={false}
              hasLoaded
              error={saveError}
              onFlush={() => {}}
              onCancel={() => {}}
            />
          </div>
        )}
      </header>

      <main className="flex-1 px-4 pt-4 pb-10">
        {isLocked && (
          <div className="mb-4 rounded-xl border border-black/10 bg-white/60 px-4 py-3 text-sm text-brand-neutral-black/70">
            This assessment is complete and locked. It can no longer be edited.
          </div>
        )}

        <div className="flex flex-col gap-6 lg:max-w-3xl">
          <section className="max-w-xs">
            <label htmlFor="assessment-date" className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
              Date
            </label>
            <input
              id="assessment-date"
              type="date"
              value={assessment.assessmentDate}
              disabled={isLocked}
              onChange={(e) => saveField({ assessmentDate: e.target.value })}
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black disabled:bg-black/5"
            />
          </section>

          <section>
            <p className="mb-1.5 text-sm font-semibold text-brand-neutral-black">Respondent</p>
            <div className="flex flex-wrap gap-2">
              {RESPONDENT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={isLocked}
                  onClick={() => handleRespondentPick(opt.value)}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                    assessment.respondentType === opt.value
                      ? "border-brand-prussian-blue bg-brand-prussian-blue text-white"
                      : "border-black/10 bg-white text-brand-neutral-black/70"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="mb-1.5 text-sm font-semibold text-brand-neutral-black">
              Responses ({Object.keys(draftResponses).length}/{rowNumbers.length})
            </p>
            <div className="flex flex-col divide-y divide-black/5 rounded-2xl border border-black/5 bg-white">
              {rowNumbers.map((n) => {
                const current = draftResponses[String(n)];
                return (
                  <div key={n} className="flex flex-col gap-1.5 px-4 py-2.5">
                    <span className="font-accent text-xs font-bold text-brand-neutral-black/40">Row {n}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {scale.map((option) => (
                        <button
                          key={option}
                          type="button"
                          disabled={isLocked}
                          onClick={() => handleAnswerTap(n, option)}
                          aria-pressed={current === option}
                          className={`flex h-9 flex-shrink-0 items-center justify-center rounded-xl border px-3 text-xs font-bold transition-colors disabled:cursor-not-allowed ${
                            current === option
                              ? "border-brand-prussian-blue bg-brand-prussian-blue text-white"
                              : "border-black/10 bg-white text-brand-neutral-black/70"
                          }`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-sm font-semibold text-brand-neutral-black">Subscale totals</p>
              {!isLocked && (
                <button
                  type="button"
                  onClick={handleAddSubscaleTotal}
                  className="text-xs font-semibold text-brand-prussian-blue"
                >
                  + Add total
                </button>
              )}
            </div>
            <p className="-mt-0.5 mb-2 text-xs text-brand-neutral-black/50">
              Enter each subscale name and total from the paper&apos;s own scoring key. Not computed here.
            </p>

            {draftSubscaleTotals.length === 0 ? (
              <p className="rounded-xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/50">
                No subscale totals recorded yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {draftSubscaleTotals.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={row.label}
                      disabled={isLocked}
                      placeholder="Subscale name"
                      onChange={(e) => handleSubscaleTotalChange(i, { label: e.target.value })}
                      className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black disabled:bg-black/5"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={row.total}
                      disabled={isLocked}
                      placeholder="Total"
                      onChange={(e) => handleSubscaleTotalChange(i, { total: e.target.value })}
                      className="w-20 flex-shrink-0 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black disabled:bg-black/5"
                    />
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() => handleRemoveSubscaleTotal(i)}
                        aria-label="Remove"
                        className="flex-shrink-0 text-lg text-brand-neutral-black/30"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <AttachmentsSection
            assessmentId={assessmentId}
            isLocked={isLocked}
            title="Completed paper form"
            helpText="Attach the paper form once it's been filled in, as the source document."
          />

          {!isLocked && (
            <section>
              {completeError && (
                <p role="alert" className="mb-2 text-sm font-medium text-red-600">
                  {completeError}
                </p>
              )}
              <button
                type="button"
                onClick={handleComplete}
                disabled={isCompleting}
                className="w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 lg:w-auto lg:px-6"
              >
                {isCompleting ? "Completing…" : "Mark as Completed"}
              </button>
              <p className="mt-1.5 text-xs text-brand-neutral-black/50">
                Locks this assessment. It can no longer be edited after this.
              </p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
