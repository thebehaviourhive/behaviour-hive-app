"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAflsItemBank } from "@/hooks/useAflsItemBank";
import { useAflsAssessmentsForFba, SaveCancelledError } from "@/hooks/useAflsAssessmentsForFba";
import { AFLS_DOMAINS, AFLS_NA_RULE_HINTS } from "@/lib/fba/types";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { BottomSheet } from "@/components/ui/BottomSheet";
import type { AflsAssessment, AflsScores, AflsTaskScore, InstrumentItem } from "@/lib/fba/types";

// Imperative handle so the routing page's own flushAndAdvance (Back/
// Previous/Next) can wait for THIS section's own save queue before
// navigating away -- AFLS save resilience, 15 Sept 2026. Deliberately
// not folded into the generic content_data flush: this section has no
// shared `content` blob at that level at all (see this file's own
// header comment), so the routing page can't wait on anything it
// already tracks. Exposing exactly one method keeps the coupling
// narrow -- the routing page doesn't need to know anything about
// saveQueueRef, tokens, or AFLS's own internal status vocabulary.
export interface AflsSectionHandle {
  // Resolves once whatever's currently queued has settled, true only if
  // it actually saved -- false for a cancelled or failed save, so the
  // caller can refuse to navigate rather than lose the edit one step
  // later (same "stay put unless truly saved" rule flushAndAdvance
  // already applies to the generic path).
  flushPendingSave: () => Promise<boolean>;
}

// Section 11 REBUILD: the AFLS is conducted ON PAPER -- this is the
// transcription and results layer only. Fully self-contained (own
// fetch + CRUD via useAflsAssessmentsForFba), matching the Calm Cards
// precedent (useCalmCardsForFba/CalmCardSection) rather than being
// threaded through the routing page's generic content-save machinery
// -- companion layer throughout, so this never gates on readOnly (see
// migration 0060: assessments stay addable/editable after the FBA
// locks).
//
// Two views live in this one component (no route change, matching the
// domain-expand/collapse convention the old AflsSection already used):
// a LIST of assessments, and a per-assessment ENTRY view.
//
// Auto-save is per-tap, not per-blur: a chip tap fires an immediate
// save, with the previous in-flight save aborted if a newer tap lands
// first. Draft state updates synchronously first, so the tap always
// feels instant regardless of round-trip latency, while the small
// inline indicator reflects the actual persistence state separately.
function scoreOptionsFor(maxScore: number): number[] {
  return Array.from({ length: maxScore + 1 }, (_, i) => i);
}

function formatAssessmentDate(dateStr: string): string {
  // yyyy-mm-dd -- parsed as local, not UTC, so the date shown always
  // matches what the clinician actually typed (avoids the classic
  // "off by one day" bug from new Date("yyyy-mm-dd") parsing as UTC
  // midnight and then rendering in a behind-UTC timezone).
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}

type InlineStatus = "idle" | "saving" | "waiting-for-connection" | "saved" | "error";

// Same vocabulary and behaviour as SavedStateIndicator.tsx (the generic
// content_data path's own header indicator), scaled down to this
// section's own inline pill: "waiting-for-connection" and "error" both
// get a retry tap-target, and waiting additionally gets Cancel, since
// that's the one state that could otherwise retry indefinitely.
function InlineSaveStatus({
  status,
  onRetry,
  onCancel,
}: {
  status: InlineStatus;
  onRetry: () => void;
  onCancel: () => void;
}) {
  if (status === "waiting-for-connection" || status === "error") {
    const label = status === "waiting-for-connection" ? "Offline" : "Couldn't save";
    return (
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-semibold text-brand-golden-brown underline underline-offset-2"
        >
          {label} · Retry
        </button>
        {status === "waiting-for-connection" && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-medium text-brand-golden-brown underline underline-offset-2"
          >
            Cancel
          </button>
        )}
      </span>
    );
  }
  if (status === "saving") return <span className="text-xs font-semibold text-brand-pastel-blue animate-pulse">Saving…</span>;
  if (status === "saved") return <span className="text-xs font-semibold text-green-600">Saved</span>;
  return null;
}

function DomainCard({
  domainCode,
  domainName,
  items,
  scores,
  comment,
  onScoreTap,
  onCommentChange,
  onCommentBlur,
}: {
  domainCode: string;
  domainName: string;
  items: InstrumentItem[];
  scores: AflsScores;
  comment: string;
  onScoreTap: (taskCode: string, value: AflsTaskScore) => void;
  onCommentChange: (domainCode: string, value: string) => void;
  onCommentBlur: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const scoredCount = items.filter((item) => scores[item.id] !== undefined).length;

  return (
    <div className="rounded-2xl border border-black/5 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 p-3.5 text-left"
      >
        <div>
          <p className="font-heading text-sm font-bold text-brand-prussian-blue">{domainName}</p>
          <p className="text-xs text-brand-neutral-black/50">
            {domainCode} · {scoredCount}/{items.length} scored
          </p>
        </div>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-brand-neutral-black/40 transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      </button>

      {isExpanded && (
        <div className="divide-y divide-black/5 border-t border-black/5">
          {items.map((item) => {
            const current = scores[item.id];
            const options = scoreOptionsFor(item.maxScore ?? 2);
            return (
              <div key={item.id} className="flex flex-col gap-1.5 px-3.5 py-2.5">
                <div>
                  <span className="mr-1.5 font-accent text-xs font-bold text-brand-neutral-black/40">{item.id}</span>
                  <span className="text-sm text-brand-neutral-black">{item.text}</span>
                  {item.naRule && (
                    <span className="ml-1.5 text-xs italic text-brand-neutral-black/40">
                      ({AFLS_NA_RULE_HINTS[item.naRule]})
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {options.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onScoreTap(item.id, value)}
                      aria-pressed={current === value}
                      className={`flex h-9 min-w-9 flex-shrink-0 items-center justify-center rounded-xl border px-2 text-sm font-bold transition-colors ${
                        current === value
                          ? "border-brand-prussian-blue bg-brand-prussian-blue text-white"
                          : "border-black/10 bg-white text-brand-neutral-black/70"
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => onScoreTap(item.id, "NA")}
                    aria-pressed={current === "NA"}
                    className={`flex h-9 flex-shrink-0 items-center justify-center rounded-xl border px-3 text-xs font-bold transition-colors ${
                      current === "NA"
                        ? "border-brand-neutral-black bg-brand-neutral-black text-white"
                        : "border-black/10 bg-white text-brand-neutral-black/50"
                    }`}
                  >
                    N/A
                  </button>
                </div>
              </div>
            );
          })}

          {/* CHANGE 3 (2026-08-21): per-domain clinician comment, at
              the END of the domain's own section -- placed here (the
              editable transcription view) rather than only in the
              read-only results grid, since this is where the
              clinician actually reviews a domain once they've
              finished scoring it. Follows this file's own established
              autosave convention: local draft state lifted to the
              parent (draftComments/draftCommentsRef, mirroring
              draftScores), save fired on blur through the same
              queueSave chain scores/assessor already use, status
              reflected by the single shared InlineSaveStatus above. */}
          <div className="px-3.5 py-3">
            <label className="mb-1 block text-xs font-semibold text-brand-neutral-black">
              Comments on {domainName}
            </label>
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => onCommentChange(domainCode, e.target.value)}
              onBlur={() => onCommentBlur()}
              placeholder="Add any clinical notes for this domain…"
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export const AflsSection = forwardRef<AflsSectionHandle, { fbaId: string }>(function AflsSection({ fbaId }, ref) {
  const { itemsByDomain, loadError: itemBankError, refresh: refreshItemBank } = useAflsItemBank();
  const { assessments, loadError, reload, createAssessment, updateAssessment, deleteAssessment } =
    useAflsAssessmentsForFba(fbaId);
  const [openAssessmentId, setOpenAssessmentId] = useState<string | null>(null);
  const [draftScores, setDraftScores] = useState<AflsScores>({});
  const [draftComments, setDraftComments] = useState<Record<string, string>>({});
  const [draftDate, setDraftDate] = useState("");
  const [draftAssessor, setDraftAssessor] = useState("");
  const [status, setStatus] = useState<InlineStatus>("idle");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const saveTokenRef = useRef(0);
  // A rapid burst of taps must never race the network: two independent
  // in-flight PATCHes can resolve out of order, and whichever lands
  // LAST wins -- silently dropping an earlier, still-legitimate tap
  // even though its own request "succeeded". Every save is instead
  // funnelled through one promise chain per open assessment, so saves
  // to the SAME assessment always execute strictly one-after-another;
  // a queued save also re-reads draftScoresRef at the moment it
  // actually RUNS (not when it was queued), so several taps that land
  // before the previous save even starts coalesce into a single PATCH
  // carrying the final merged state, instead of firing one PATCH per
  // tap. draftScoresRef mirrors draftScores synchronously (state
  // updates aren't visible to same-tick closures) -- see handleScoreTap.
  //
  // AFLS save resilience, 15 Sept 2026: the chain's own type is now
  // Promise<"saved"|"cancelled"|"error">, not Promise<void> -- each step
  // resolves to (never rejects with) its own real outcome, same
  // vocabulary the generic content_data path's saveContent returns, so
  // flushPendingSave below can check the outcome directly rather than
  // re-reading `status` state after an await (that would be a stale
  // closure read, same pitfall the generic path's own flushAndAdvance
  // was built to avoid).
  const saveQueueRef = useRef<Promise<"saved" | "cancelled" | "error">>(Promise.resolve("saved"));
  const draftScoresRef = useRef<AflsScores>({});
  const draftCommentsRef = useRef<Record<string, string>>({});
  // Always points at whichever save is CURRENTLY executing (set inside
  // the queue step itself, not at queueSave call time) -- a rapid burst
  // of taps still coalesces exactly as before (this does NOT abort a
  // still-QUEUED-but-not-yet-running save the way triggerSave's own
  // abort-latest-wins does for the generic path); this ref exists only
  // so the manual Cancel control can abort whichever attempt is
  // actually in flight right now.
  const saveAbortRef = useRef<AbortController | null>(null);

  const openAssessment = openAssessmentId ? assessments.find((a) => a.id === openAssessmentId) ?? null : null;

  function openEntryFor(assessment: AflsAssessment) {
    setOpenAssessmentId(assessment.id);
    setDraftScores(assessment.scores);
    draftScoresRef.current = assessment.scores;
    setDraftComments(assessment.domainComments ?? {});
    draftCommentsRef.current = assessment.domainComments ?? {};
    setDraftDate(assessment.assessmentDate);
    setDraftAssessor(assessment.assessorName);
    setStatus("idle");
    saveQueueRef.current = Promise.resolve("saved");
  }

  // Queues one save behind whatever's already pending for this
  // assessment. `buildPatch` is called only once the save actually
  // starts running, so it always sees the truly-latest draft state.
  //
  // AFLS save resilience, 15 Sept 2026: now passes onStatusChange/signal
  // through to updateAssessment (offline-retry, same insertWithOfflineRetry
  // the generic path uses) and returns the settled outcome, chained --
  // deliberately does NOT abort a previous call's controller here (that
  // would break the existing coalescing behaviour above); saveAbortRef is
  // only ever set to whichever attempt is actually running right now.
  function queueSave(
    assessmentId: string,
    buildPatch: () => Partial<{
      assessmentDate: string;
      assessorName: string;
      scores: AflsScores;
      domainComments: Record<string, string>;
    }>
  ): Promise<"saved" | "cancelled" | "error"> {
    const token = ++saveTokenRef.current;
    setStatus("saving");
    const outcome = saveQueueRef.current.then(async () => {
      const controller = new AbortController();
      saveAbortRef.current = controller;
      try {
        await updateAssessment(
          assessmentId,
          buildPatch(),
          (s) => {
            if (saveTokenRef.current === token) setStatus(s);
          },
          controller.signal
        );
        if (saveTokenRef.current === token) setStatus("saved");
        return "saved" as const;
      } catch (err) {
        if (err instanceof SaveCancelledError) {
          if (saveTokenRef.current === token) setStatus("idle");
          return "cancelled" as const;
        }
        console.error("Failed to save AFLS assessment:", err);
        if (saveTokenRef.current === token) setStatus("error");
        return "error" as const;
      }
    });
    saveQueueRef.current = outcome;
    return outcome;
  }

  // Manual retry: re-sends the FULL current draft (every field, not
  // just whichever one last failed) -- same posture as the generic
  // path's own flush, which always saves the whole content blob rather
  // than tracking which specific field changed. Simpler, and safe:
  // idempotent regardless of which field originally failed.
  function retrySave() {
    if (!openAssessmentId) return;
    const id = openAssessmentId;
    queueSave(id, () => ({
      assessmentDate: draftDate,
      assessorName: draftAssessor,
      scores: draftScoresRef.current,
      domainComments: draftCommentsRef.current,
    }));
  }

  function cancelSave() {
    saveAbortRef.current?.abort();
  }

  useImperativeHandle(ref, () => ({
    async flushPendingSave() {
      const outcome = await saveQueueRef.current;
      return outcome === "saved";
    },
  }));

  function handleScoreTap(taskCode: string, value: AflsTaskScore) {
    if (!openAssessmentId) return;
    const next = { ...draftScoresRef.current, [taskCode]: value };
    draftScoresRef.current = next;
    setDraftScores(next);
    const id = openAssessmentId;
    queueSave(id, () => ({ scores: draftScoresRef.current }));
  }

  function handleDateChange(value: string) {
    if (!openAssessmentId) return;
    setDraftDate(value);
    const id = openAssessmentId;
    queueSave(id, () => ({ assessmentDate: value }));
  }

  function handleAssessorBlur() {
    if (!openAssessmentId) return;
    const id = openAssessmentId;
    const assessorName = draftAssessor;
    queueSave(id, () => ({ assessorName }));
  }

  // Draft state updates synchronously (same reasoning as
  // handleScoreTap's own comment on draftScoresRef) so a fast blur
  // right after typing never races a save that read a stale value.
  // Save itself is blur-triggered, not per-keystroke -- matches
  // handleAssessorBlur exactly, just keyed per domain.
  function handleCommentChange(domainCode: string, value: string) {
    const next = { ...draftCommentsRef.current, [domainCode]: value };
    draftCommentsRef.current = next;
    setDraftComments(next);
  }

  function handleCommentBlur() {
    if (!openAssessmentId) return;
    const id = openAssessmentId;
    queueSave(id, () => ({ domainComments: draftCommentsRef.current }));
  }

  // Fetched fresh at creation time, not speculatively on mount --
  // an on-mount fetch raced the tap on a fast enough double-tap (the
  // assessor field would land empty if [+ Add] fired before the fetch
  // resolved). Awaiting it inline here removes that race entirely; the
  // field stays fully editable from there regardless.
  async function handleCreate() {
    setIsCreating(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      let assessorName = "";
      if (user) {
        const { data } = await supabase.from("clinicians").select("full_name").eq("user_id", user.id).maybeSingle();
        assessorName = data?.full_name ?? "";
      }
      const created = await createAssessment(assessorName);
      openEntryFor(created);
    } catch (err) {
      console.error("Failed to create AFLS assessment:", err);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDeleteId) return;
    setIsDeleting(true);
    try {
      await deleteAssessment(pendingDeleteId);
      if (openAssessmentId === pendingDeleteId) setOpenAssessmentId(null);
      setPendingDeleteId(null);
    } catch (err) {
      console.error("Failed to delete AFLS assessment:", err);
    } finally {
      setIsDeleting(false);
    }
  }

  if (itemBankError || loadError) {
    return (
      <InlineErrorState
        message={itemBankError ? "Couldn't load the AFLS item bank." : "Couldn't load AFLS assessments."}
        onRetry={() => {
          refreshItemBank();
          reload();
        }}
      />
    );
  }

  if (!itemsByDomain) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-16 animate-pulse rounded-2xl bg-white" />
        <div className="h-16 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  // ================= ENTRY VIEW =================
  if (openAssessment) {
    const totalScored = Object.keys(draftScores).length;
    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setOpenAssessmentId(null)}
          className="flex w-fit items-center gap-1 text-sm font-semibold text-brand-prussian-blue"
        >
          ‹ All assessments
        </button>

        <div className="flex flex-col gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="font-heading text-base font-bold text-brand-neutral-black">Assessment details</p>
            <InlineSaveStatus status={status} onRetry={retrySave} onCancel={cancelSave} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-brand-neutral-black">Assessment date</label>
              <input
                type="date"
                value={draftDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-brand-neutral-black">Assessor</label>
              <input
                type="text"
                value={draftAssessor}
                onChange={(e) => setDraftAssessor(e.target.value)}
                onBlur={handleAssessorBlur}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              />
            </div>
          </div>
          <p className="text-xs text-brand-neutral-black/50">{totalScored}/225 tasks scored</p>
        </div>

        <div className="flex flex-col gap-2.5">
          {AFLS_DOMAINS.map((domain) => (
            <DomainCard
              key={domain.code}
              domainCode={domain.code}
              domainName={domain.name}
              items={itemsByDomain[domain.code] ?? []}
              scores={draftScores}
              comment={draftComments[domain.code] ?? ""}
              onScoreTap={handleScoreTap}
              onCommentChange={handleCommentChange}
              onCommentBlur={handleCommentBlur}
            />
          ))}
        </div>
      </div>
    );
  }

  // ================= LIST VIEW =================
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleCreate}
        disabled={isCreating}
        className="flex w-full items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-brand-prussian-blue/30 py-3 text-sm font-semibold text-brand-prussian-blue disabled:opacity-40"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
        {isCreating ? "Creating…" : "Add AFLS Assessment"}
      </button>

      {assessments.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/50">
          No AFLS assessments recorded yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {assessments.map((assessment) => {
            const scoredCount = Object.keys(assessment.scores ?? {}).length;
            return (
              <div
                key={assessment.id}
                className="flex items-center gap-2 rounded-2xl border border-black/5 bg-white p-3.5 shadow-sm"
              >
                <button type="button" onClick={() => openEntryFor(assessment)} className="min-w-0 flex-1 text-left">
                  <p className="font-semibold text-brand-neutral-black">{formatAssessmentDate(assessment.assessmentDate)}</p>
                  <p className="truncate text-xs text-brand-neutral-black/50">
                    {assessment.assessorName || "No assessor set"} · {scoredCount}/225 scored
                  </p>
                </button>
                <button
                  type="button"
                  aria-label="Delete assessment"
                  onClick={() => setPendingDeleteId(assessment.id)}
                  className="flex-shrink-0 p-1.5 text-brand-neutral-black/30"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <BottomSheet isOpen={!!pendingDeleteId} onClose={() => !isDeleting && setPendingDeleteId(null)}>
        <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Delete this assessment?</h2>
        <p className="mt-2 text-sm text-brand-neutral-black/70">
          This permanently removes every score recorded for it. This can&apos;t be undone.
        </p>
        <button
          type="button"
          onClick={handleConfirmDelete}
          disabled={isDeleting}
          className="mt-6 w-full rounded-2xl bg-red-600 py-3.5 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isDeleting ? "Deleting…" : "Delete Assessment"}
        </button>
        <button
          type="button"
          onClick={() => setPendingDeleteId(null)}
          disabled={isDeleting}
          className="mt-2 w-full rounded-2xl border-2 border-black/10 py-3 text-sm font-semibold text-black/60 disabled:opacity-40"
        >
          Cancel
        </button>
      </BottomSheet>
    </div>
  );
});
