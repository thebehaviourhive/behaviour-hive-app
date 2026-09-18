"use client";

import { useEffect, useRef, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useClinicianReviewState } from "@/hooks/useClinicianReviewState";
import { ClinicianAccessGate } from "@/components/clinician/ClinicianAccessGate";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { SavedStateIndicator } from "@/components/clinician/fba/SavedStateIndicator";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useSessionNote } from "@/hooks/useSessionNote";

// PRD 6 Stage 2 -- the writing surface itself.
//
// SIDE BY SIDE, THE REQUIREMENT THAT MATTERS MOST. A plain
// `lg:grid-cols-2` on the two fields -- both mounted, both visible,
// both editable at once at lg+, no tab, no second screen, no scroll
// between them. Deliberately NOT capped at FbaSectionShell's own
// lg:max-w-[66.6667%] -- that cap is right for a single column of form
// fields; here it would squeeze two genuinely-sized text columns into
// less room than they need. This screen builds its own, wider shell
// rather than reusing FbaSectionShell, for that one reason.
//
// Below lg, side by side is physically impossible (that's not a
// judgment call, it's arithmetic) -- both fields stay on the SAME
// screen, stacked, always mounted, reachable by an ordinary scroll.
// The three alternatives named as ruled out for desktop (two screens,
// tabs, a scroll between stacked fields) were reasoned about in the
// desktop context, where side-by-side is achievable and preferred; at
// a width where it genuinely isn't, stacking becomes the last one
// standing BY ELIMINATION -- two screens or tabs fragment the writing
// flow worse than a scroll does, losing all context of the other field
// rather than just losing visual simultaneity. The "copy" action below
// carries more of the weight at this width, for exactly that reason.
//
// THE TOGGLE IS A ONE-TIME COPY, NOT A LIVE LINK. Ticking a persistent
// "same as clinical record" checkbox that kept syncing on every
// keystroke would recreate, client-side, the exact link the schema
// explicitly refuses to build (0228's own header: "no trigger, no
// generated column, no constraint... the absence of any syncing
// mechanism IS the enforcement"). A plain button that copies the
// CURRENT clinical_record text into parent_note's draft, once, on
// click, cannot silently re-link them later -- there's no ongoing
// behaviour left to misfire.
//
// SHARING IS ITS OWN DELIBERATE ACT, NEVER A TOGGLE THAT FIRES ON
// SAVE. A dedicated BottomSheet confirm, same pattern as finalising an
// FBA (ReviewSection.tsx) and sharing an incident amendment
// (AddAmendmentSheet.tsx) -- previewing exactly the text that will
// cross the boundary before committing to it.
//
// ONCE SHARED, THE PRACTITIONER KNOWS BEFORE THEY EDIT, NOT AFTER. A
// persistent banner sits above the parent_note field itself -- not a
// one-time toast after the original share, not something that only
// appears once they've already saved a change -- so the fact "editing
// this will notify the parent" is visible the entire time they're
// looking at the field they're about to type into.
export function SessionNoteEditor({
  noteId,
  onNavigateBack,
}: {
  noteId: string;
  onNavigateBack: () => void;
}) {
  const { user, isReady } = useRequireRole("clinician");
  const {
    isLoading: isLoadingReview,
    profile: reviewProfile,
    reviewState,
    error: reviewError,
    refresh: refreshReview,
  } = useClinicianReviewState(user?.id ?? null);

  const { note, isLoading, loadError, reload, saveField, saveStatus, saveError, share } = useSessionNote(noteId);

  const [draftClinicalRecord, setDraftClinicalRecord] = useState("");
  const [draftParentNote, setDraftParentNote] = useState("");
  const [draftSessionDate, setDraftSessionDate] = useState("");

  // Seeds local draft state from the loaded note exactly once -- same
  // reasoning as FbaSectionEditor's own hasSeededReportRef: saveField()
  // returns a NEW note object on every successful save, which would
  // otherwise re-fire a naive effect and stomp an in-progress edit made
  // in the gap between kicking a save off and it resolving.
  const hasSeededRef = useRef(false);
  useEffect(() => {
    if (note && !hasSeededRef.current) {
      hasSeededRef.current = true;
      setDraftClinicalRecord(note.clinicalRecord);
      setDraftParentNote(note.parentNote);
      setDraftSessionDate(note.sessionDate);
    }
  }, [note]);

  // changeVersionRef/versionAtSaveStartRef: the same discipline
  // FbaSectionEditor uses for its own single shared isDirty indicator,
  // applied here across whichever of the three fields last changed --
  // one indicator for the whole note, matching SavedStateIndicator's
  // own "one control for the whole screen" design.
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

  function handleClinicalRecordBlur() {
    commitSave({ clinicalRecord: draftClinicalRecord });
  }

  function handleParentNoteBlur() {
    commitSave({ parentNote: draftParentNote });
  }

  function handleSessionDateChange(value: string) {
    setDraftSessionDate(value);
    markChanged();
    commitSave({ sessionDate: value });
  }

  function handleCopyToParentNote() {
    setDraftParentNote(draftClinicalRecord);
    markChanged();
    commitSave({ parentNote: draftClinicalRecord });
  }

  function handleFlushSave() {
    commitSave({
      sessionDate: draftSessionDate,
      clinicalRecord: draftClinicalRecord,
      parentNote: draftParentNote,
    });
  }

  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  async function handleShare() {
    setIsSharing(true);
    setShareError(null);
    const { error } = await share();
    setIsSharing(false);
    if (error) {
      setShareError(error);
      return;
    }
    setIsShareOpen(false);
  }

  if (!isReady) {
    return null;
  }

  if (isLoadingReview || reviewState !== "verified") {
    return (
      <ClinicianAccessGate
        isLoading={isLoadingReview}
        profile={reviewProfile}
        reviewState={reviewState}
        error={reviewError}
        onRetry={refreshReview}
      >
        {null}
      </ClinicianAccessGate>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-black/5 bg-brand-off-white/95 px-4 pt-6 pb-4 backdrop-blur-sm">
        <button
          type="button"
          onClick={onNavigateBack}
          aria-label="Back to session notes"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">
            Session Note
          </p>
          <h1 className="truncate font-heading text-lg font-bold text-brand-prussian-blue">
            {note ? formatSessionDateLong(draftSessionDate || note.sessionDate) : "Loading…"}
          </h1>
        </div>
        <div className="flex-shrink-0">
          <SavedStateIndicator
            status={saveStatus}
            isDirty={isDirty}
            hasLoaded={!!note}
            error={saveError}
            onFlush={handleFlushSave}
            onCancel={() => {}}
          />
        </div>
      </header>

      <main className="flex-1 px-4 pt-4 pb-10">
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <div className="h-24 animate-pulse rounded-2xl bg-white" />
            <div className="h-64 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : loadError ? (
          <InlineErrorState message={loadError} onRetry={reload} />
        ) : !note ? (
          <InlineErrorState message="This session note couldn't be found." onRetry={reload} />
        ) : (
          <div className="flex flex-col gap-6 lg:max-w-5xl">
            <div className="flex flex-col gap-1.5 lg:w-64">
              <label htmlFor="session-date" className="text-sm font-semibold text-brand-neutral-black">
                Session date
              </label>
              <input
                id="session-date"
                type="date"
                value={draftSessionDate}
                onChange={(e) => handleSessionDateChange(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              />
              <p className="text-xs text-brand-neutral-black/50">
                The date the session happened, not the date this note was written.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="clinical-record" className="text-sm font-semibold text-brand-neutral-black">
                  Clinical record
                </label>
                <p className="-mt-0.5 text-xs text-brand-neutral-black/50">
                  What was done, what was observed, what comes next. Never shown to a parent.
                </p>
                <textarea
                  id="clinical-record"
                  value={draftClinicalRecord}
                  onChange={(e) => {
                    setDraftClinicalRecord(e.target.value);
                    markChanged();
                  }}
                  onBlur={handleClinicalRecordBlur}
                  rows={12}
                  placeholder="What happened in this session…"
                  className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                />
                <button
                  type="button"
                  onClick={handleCopyToParentNote}
                  disabled={!draftClinicalRecord.trim()}
                  className="self-start text-xs font-semibold text-brand-prussian-blue underline underline-offset-2 disabled:cursor-not-allowed disabled:text-black/20 disabled:no-underline"
                >
                  Copy into parent note →
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="parent-note" className="text-sm font-semibold text-brand-neutral-black">
                  Parent note
                </label>
                <p className="-mt-0.5 text-xs text-brand-neutral-black/50">
                  What goes to the parent, once shared. Not shared by default.
                </p>

                {note.isSharedWithParent && (
                  <div className="rounded-xl bg-brand-pastel-blue/15 px-3 py-2 text-xs text-brand-prussian-blue">
                    <p className="font-semibold">Shared with the parent{formatSharedSuffix(note.sharedAt)}.</p>
                    <p className="mt-0.5">
                      Editing this field will tell them it changed
                      {note.parentNoteEditedAfterShareAt
                        ? ` — last updated after sharing ${formatRelativeShort(note.parentNoteEditedAfterShareAt)}.`
                        : "."}
                    </p>
                  </div>
                )}

                <textarea
                  id="parent-note"
                  value={draftParentNote}
                  onChange={(e) => {
                    setDraftParentNote(e.target.value);
                    markChanged();
                  }}
                  onBlur={handleParentNoteBlur}
                  rows={12}
                  placeholder="What the parent will read…"
                  className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                />

                {!note.isSharedWithParent && (
                  <button
                    type="button"
                    onClick={() => setIsShareOpen(true)}
                    disabled={!draftParentNote.trim()}
                    className="mt-1 self-start rounded-full border-2 border-brand-prussian-blue px-4 py-2 text-sm font-semibold text-brand-prussian-blue disabled:cursor-not-allowed disabled:border-black/10 disabled:text-black/20"
                  >
                    Share with parent
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      <BottomSheet isOpen={isShareOpen} onClose={() => !isSharing && setIsShareOpen(false)}>
        <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Share this note?</h2>
        <p className="mt-2 text-sm text-brand-neutral-black/70">
          The parent will be able to read the parent note below. This does not include your clinical record, which
          stays internal. If you edit the parent note again after sharing, they&apos;ll be told it changed.
        </p>
        <div className="mt-4 rounded-xl border border-black/10 bg-brand-off-white/60 p-3">
          <p className="whitespace-pre-wrap text-sm text-brand-neutral-black/80">
            {draftParentNote.trim() || "(nothing written yet)"}
          </p>
        </div>

        {shareError && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-600">
            {shareError}
          </p>
        )}

        <button
          type="button"
          onClick={handleShare}
          disabled={isSharing}
          className="mt-6 w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSharing ? "Sharing…" : "Share with Parent"}
        </button>
        <button
          type="button"
          onClick={() => setIsShareOpen(false)}
          disabled={isSharing}
          className="mt-2 w-full rounded-2xl border-2 border-black/10 py-3 text-sm font-semibold text-black/60 disabled:opacity-40"
        >
          Cancel
        </button>
      </BottomSheet>
    </div>
  );
}

function formatSessionDateLong(sessionDate: string): string {
  if (!sessionDate) return "Session Note";
  const [year, month, day] = sessionDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" });
}

function formatSharedSuffix(sharedAt: string | null): string {
  if (!sharedAt) return "";
  return ` on ${new Date(sharedAt).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}`;
}

function formatRelativeShort(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  return `${diffDays} days ago`;
}
