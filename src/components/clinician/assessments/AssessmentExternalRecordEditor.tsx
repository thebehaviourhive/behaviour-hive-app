"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SavedStateIndicator } from "@/components/clinician/fba/SavedStateIndicator";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { useAssessment, type ScoreEntry } from "@/hooks/useAssessment";
import { AttachmentsSection } from "@/components/clinician/assessments/AttachmentsSection";

// PRD 7 Stage 1 -- the external record. Per section 13: the instrument
// is copyrighted, the results are not -- this holds only the outcome
// (which instrument and version, when/by whom/where it was
// administered, the scores that matter as free entry, the clinician's
// own interpretation), never the instrument's own items or norms.
// `scores` is deliberately GENERIC -- a free-form label/value list, not
// a per-instrument template reproducing a publisher's index structure
// -- "start generic, add templates only where the licence has been
// checked" (section 13). A structured, per-instrument form arrives once
// Catherine supplies real output structures; nothing here migrates when
// it does, a structured form is offered alongside this same `scores`
// column.
//
// No attachment field or upload control -- file storage (PRD 7 section
// 14) is its own, not-yet-built piece of infrastructure. The note below
// says so plainly rather than showing a control that doesn't work.
//
// LOCAL DRAFT STATE FOR `scores`, controlled (value/onChange), NOT
// read-modify-write off `assessment.scores` on each field's own onBlur
// -- found live during deployed verification: a row's label and value
// are two sibling fields, and blurring them in quick succession could
// each read `assessment.scores` before the FIRST edit's own round trip
// had updated it, silently losing that edit when the second one's save
// landed. Local state updates synchronously on every keystroke,
// independent of the round trip, so this can't happen -- same fix,
// same reasoning, as AssessmentResponseSheetEditor's own subscale
// totals.
//
// ISDIRTY, TRACKED FOR REAL, for the plain onBlur text fields (Version/
// Administrator/Location/Interpretation) -- these previously hard-coded
// isDirty={false}, which meant "Saved" could show even for a value
// that had been typed but not yet blurred. changeVersionRef/
// versionAtSaveStartRef is the same discipline FbaSectionEditor and
// SessionNoteEditor already use for their own single shared indicator.
export function AssessmentExternalRecordEditor({ assessmentId, passportId }: { assessmentId: string; passportId: string }) {
  const router = useRouter();
  const { assessment, isLoading, loadError, reload, saveField, saveStatus, saveError, complete } =
    useAssessment(assessmentId);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const [draftScores, setDraftScores] = useState<ScoreEntry[]>([]);

  const hasSeededRef = useRef(false);
  useEffect(() => {
    if (assessment && !hasSeededRef.current) {
      hasSeededRef.current = true;
      setDraftScores(assessment.scores);
    }
  }, [assessment]);

  const changeVersionRef = useRef(0);
  const versionAtSaveStartRef = useRef(0);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (saveStatus === "saved" && versionAtSaveStartRef.current === changeVersionRef.current) {
      setIsDirty(false);
    }
  }, [saveStatus]);

  function markChanged() {
    changeVersionRef.current += 1;
    setIsDirty(true);
  }

  function commitSave(patch: Parameters<typeof saveField>[0]) {
    versionAtSaveStartRef.current = changeVersionRef.current;
    saveField(patch);
  }

  async function handleComplete() {
    setIsCompleting(true);
    setCompleteError(null);
    const { error } = await complete();
    setIsCompleting(false);
    if (error) setCompleteError(error);
  }

  function handleAddScore() {
    const next = [...draftScores, { label: "", value: "" }];
    setDraftScores(next);
    saveField({ scores: next });
  }

  function handleScoreChange(index: number, patch: Partial<ScoreEntry>) {
    const next = draftScores.map((row, i) => (i === index ? { ...row, ...patch } : row));
    setDraftScores(next);
    saveField({ scores: next });
  }

  function handleRemoveScore(index: number) {
    const next = draftScores.filter((_, i) => i !== index);
    setDraftScores(next);
    saveField({ scores: next });
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
            {assessment.instrumentName} · External record
          </p>
          <h1 className="truncate font-heading text-lg font-bold text-brand-prussian-blue">
            {isLocked ? "Completed" : "In progress"}
          </h1>
        </div>
        {!isLocked && (
          <div className="flex-shrink-0">
            <SavedStateIndicator
              status={saveStatus}
              isDirty={isDirty}
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

        <div className="flex flex-col gap-6 lg:max-w-2xl">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Version">
              <input
                type="text"
                defaultValue={assessment.instrumentVersion}
                disabled={isLocked}
                placeholder="e.g. UK edition, 2016"
                onChange={markChanged}
                onBlur={(e) => commitSave({ instrumentVersion: e.target.value })}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black disabled:bg-black/5"
              />
            </Field>
            <Field label="Date administered">
              <input
                type="date"
                value={assessment.assessmentDate}
                disabled={isLocked}
                onChange={(e) => saveField({ assessmentDate: e.target.value })}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black disabled:bg-black/5"
              />
            </Field>
            <Field label="Administrator">
              <input
                type="text"
                defaultValue={assessment.administratorName}
                disabled={isLocked}
                placeholder="Who administered it"
                onChange={markChanged}
                onBlur={(e) => commitSave({ administratorName: e.target.value })}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black disabled:bg-black/5"
              />
            </Field>
            <Field label="Location">
              <input
                type="text"
                defaultValue={assessment.location}
                disabled={isLocked}
                placeholder="Where it took place"
                onChange={markChanged}
                onBlur={(e) => commitSave({ location: e.target.value })}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black disabled:bg-black/5"
              />
            </Field>
          </div>

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-sm font-semibold text-brand-neutral-black">Scores</p>
              {!isLocked && (
                <button type="button" onClick={handleAddScore} className="text-xs font-semibold text-brand-prussian-blue">
                  + Add score
                </button>
              )}
            </div>
            <p className="-mt-0.5 mb-2 text-xs text-brand-neutral-black/50">
              Composites, indices, percentiles, confidence intervals -- whatever the report gives.
            </p>

            {draftScores.length === 0 ? (
              <p className="rounded-xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/50">
                No scores recorded yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {draftScores.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={row.label}
                      disabled={isLocked}
                      placeholder="e.g. FSIQ"
                      onChange={(e) => handleScoreChange(i, { label: e.target.value })}
                      className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black disabled:bg-black/5"
                    />
                    <input
                      type="text"
                      value={row.value}
                      disabled={isLocked}
                      placeholder="e.g. 87"
                      onChange={(e) => handleScoreChange(i, { value: e.target.value })}
                      className="w-28 flex-shrink-0 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black disabled:bg-black/5"
                    />
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() => handleRemoveScore(i)}
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

          <Field label="Interpretation">
            <textarea
              defaultValue={assessment.interpretation}
              disabled={isLocked}
              rows={6}
              placeholder="Your own reading of the results, in your own words…"
              onChange={markChanged}
              onBlur={(e) => commitSave({ interpretation: e.target.value })}
              className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-brand-neutral-black placeholder:text-black/30 disabled:bg-black/5"
            />
          </Field>

          <AttachmentsSection
            artefactId={assessmentId}
            artefactType="assessment"
            isLocked={isLocked}
            title="Report"
            helpText="Attach the full report PDF, or a photo of it."
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-semibold text-brand-neutral-black">{label}</label>
      {children}
    </div>
  );
}
