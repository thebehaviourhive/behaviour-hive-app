"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { insertWithOfflineRetry } from "@/lib/waitForReconnect";
import { useInstrumentItems } from "@/hooks/useInstrumentItems";
import { getChildDisplayName } from "@/lib/childDisplayName";
import { INSTRUMENT_LABELS, type InstrumentResponsesData, type MyInstrumentRequest } from "@/lib/fba/types";

// The recipient's blind completion flow. Full-screen, not a bottom
// sheet -- deliberately distinct from ABCLogger's 85vh sheet, since the
// brief calls for "clean, distraction-free" and this can run to 25
// items, not a 4-step log. Never shows a score, a result, or anything
// that could be traced back to the FBA itself -- only the instrument's
// own question text and this recipient's own answers.
export function QuestionnaireFlow({
  request,
  track,
  onClose,
  onComplete,
}: {
  request: MyInstrumentRequest;
  track: "parent" | "teacher";
  onClose: () => void;
  onComplete: () => void;
}) {
  const { items, isLoading: isLoadingItems, loadError: itemsError } = useInstrumentItems(request.instrumentType);
  const [answers, setAnswers] = useState<InstrumentResponsesData>({});
  const [isLoadingExisting, setIsLoadingExisting] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showThankYou, setShowThankYou] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Loads this recipient's own saved progress -- allowed by their own
  // unconditional SELECT policy on fba_instrument_requests (Stage 1),
  // scoped to this one row by id.
  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase
      .from("fba_instrument_requests")
      .select("responses_data")
      .eq("id", request.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          console.error("Failed to load saved responses:", error);
          setLoadError("Couldn't load your questionnaire.");
          setIsLoadingExisting(false);
          return;
        }
        setAnswers((data?.responses_data as InstrumentResponsesData) ?? {});
        setIsLoadingExisting(false);
      });
    return () => {
      isMounted = false;
    };
  }, [request.id]);

  // Body scroll lock for the lifetime of this full-screen takeover --
  // same idiom as ABCLogger, including the iOS Safari rubber-band fix.
  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    const previous = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    return () => {
      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      window.scrollTo(0, scrollY);
    };
  }, []);

  function setAnswer(itemId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [itemId]: value }));
  }

  const isRatingInstrument = request.instrumentType !== "open_ended";
  const totalItems = items?.length ?? 0;
  const answeredCount = items
    ? items.filter((item) => (answers[item.id] ?? "").trim() !== "").length
    : 0;
  const allAnswered = totalItems > 0 && answeredCount === totalItems;

  // Precomputes category-heading boundaries by comparing each item to
  // its predecessor in the array, rather than mutating a running
  // "lastCategory" variable during render.
  const itemsWithHeadings = (items ?? []).map((item, index) => ({
    item,
    showHeading: Boolean(item.category) && item.category !== items?.[index - 1]?.category,
  }));

  async function persist(status: "in_progress" | "completed"): Promise<string | null> {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const supabase = createClient();
    return insertWithOfflineRetry(
      () =>
        supabase
          .from("fba_instrument_requests")
          .update({ responses_data: answers, status })
          .eq("id", request.id),
      (status) => setIsSaving(status === "saving" || status === "waiting-for-connection"),
      controller.signal
    );
  }

  async function handleSaveAndExit() {
    setSaveError(null);
    const error = await persist("in_progress");
    setIsSaving(false);
    if (error === "cancelled") return;
    if (error) {
      setSaveError(error);
      return;
    }
    onClose();
  }

  async function handleSubmit() {
    setSaveError(null);
    const error = await persist("completed");
    setIsSaving(false);
    if (error === "cancelled") return;
    if (error) {
      setSaveError(error);
      return;
    }
    setShowThankYou(true);
    setTimeout(onComplete, 1600);
  }

  const childLabel = track === "teacher" ? getChildDisplayName(request.childName) : request.childName;

  if (isLoadingItems || isLoadingExisting) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-pastel-blue border-t-brand-prussian-blue" />
      </div>
    );
  }

  if (itemsError || loadError || !items) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <p className="text-sm text-red-600">{itemsError ?? loadError}</p>
        <button type="button" onClick={onClose} className="text-sm font-semibold text-brand-prussian-blue">
          Close
        </button>
      </div>
    );
  }

  if (showThankYou) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-white px-8 text-center">
        <span aria-hidden className="text-4xl">
          ✅
        </span>
        <p className="font-heading text-lg font-semibold text-brand-prussian-blue">Thank you!</p>
        <p className="max-w-xs text-sm text-brand-neutral-black/70">
          Your insights help {request.clinicianName} support {childLabel}.
        </p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-black/5 px-4 pt-6 pb-4">
        <button
          type="button"
          onClick={handleSaveAndExit}
          aria-label="Save and exit"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-lg font-bold text-brand-prussian-blue">
            {INSTRUMENT_LABELS[request.instrumentType]}
          </p>
          <p className="truncate text-xs text-brand-neutral-black/50">About {childLabel}</p>
        </div>
        {isRatingInstrument && (
          <p className="flex-shrink-0 text-xs font-semibold text-brand-neutral-black/50">
            {answeredCount} of {totalItems}
          </p>
        )}
      </header>

      {isRatingInstrument && (
        <div className="h-1.5 w-full flex-shrink-0 bg-black/10">
          <div
            className="h-full bg-brand-prussian-blue transition-all"
            style={{ width: `${totalItems > 0 ? (answeredCount / totalItems) * 100 : 0}%` }}
          />
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 py-5">
        <div className="flex flex-col gap-6">
          {itemsWithHeadings.map(({ item, showHeading }) => (
            <div key={item.id}>
              {showHeading && (
                <p className="mb-3 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">
                  {item.category}
                </p>
              )}
              <p className="mb-3 text-base font-medium text-brand-neutral-black">{item.text}</p>
              {item.answer_type === "free_text" ? (
                <textarea
                  value={answers[item.id] ?? ""}
                  onChange={(e) => setAnswer(item.id, e.target.value)}
                  rows={4}
                  placeholder="Your answer…"
                  className="w-full resize-none rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                />
              ) : (
                <div className="flex flex-col gap-2">
                  {(item.scale ?? []).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setAnswer(item.id, option)}
                      className={`w-full rounded-2xl border py-3.5 text-base font-semibold transition-colors ${
                        answers[item.id] === option
                          ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                          : "border-black/10 bg-white text-brand-neutral-black"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </main>

      {saveError && (
        <p role="alert" className="px-4 pb-2 text-sm font-medium text-red-600">
          {saveError}
        </p>
      )}

      <div className="flex flex-shrink-0 flex-col gap-2 border-t border-black/5 p-4">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSaving || (isRatingInstrument && !allAnswered)}
          className="w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSaving ? "Submitting…" : "Submit"}
        </button>
        <button
          type="button"
          onClick={handleSaveAndExit}
          disabled={isSaving}
          className="w-full rounded-2xl border-2 border-brand-prussian-blue py-3.5 text-base font-semibold text-brand-prussian-blue disabled:opacity-40"
        >
          Save &amp; continue later
        </button>
      </div>
    </div>
  );
}
