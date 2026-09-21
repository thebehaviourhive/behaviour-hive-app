"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useClinicianReviewState } from "@/hooks/useClinicianReviewState";
import { ClinicianAccessGate } from "@/components/clinician/ClinicianAccessGate";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { SavedStateIndicator } from "@/components/clinician/fba/SavedStateIndicator";
import { AttachmentsSection } from "@/components/clinician/assessments/AttachmentsSection";
import { useClinicalPlan } from "@/hooks/useClinicalPlan";
import { PLAN_TYPE_LABELS } from "@/lib/clinicalPlans";

// PRD 7 -- the Silo 2 placeholders' own workspace: a name, a date, a
// free-text body, and an attachment. No completion lock (migration
// 0244's own table comment) -- so unlike SessionNoteEditor/
// FbaSectionEditor there's no locked/read-only branch anywhere here,
// only "loading" and "loaded". changeVersionRef/versionAtSaveStartRef
// is the same single-indicator discipline those two already use.
//
// School visibility: a plain three-way choice (type default / clinic
// only / shareable) writing school_visibility_override directly --
// null means "inherit the type's own default", which is 'shareable'
// for all five of these types today (migration 0244). This is the
// ONLY thing on this screen a clinician can use to pull a specific
// plan back to clinic-only, overriding the type-level default.
export default function ClinicalPlanPage() {
  const router = useRouter();
  const params = useParams<{ planId: string }>();
  const planId = params.planId;

  const { user, isReady } = useRequireRole("clinician");
  const {
    isLoading: isLoadingReview,
    profile: reviewProfile,
    reviewState,
    institutionJoinPending,
    error: reviewError,
    refresh: refreshReview,
  } = useClinicianReviewState(user?.id ?? null);

  const { plan, isLoading, loadError, reload, saveField, saveStatus, saveError } = useClinicalPlan(planId);

  const [draftName, setDraftName] = useState("");
  const [draftPlanDate, setDraftPlanDate] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const hasSeededRef = useRef(false);
  useEffect(() => {
    if (plan && !hasSeededRef.current) {
      hasSeededRef.current = true;
      setDraftName(plan.name);
      setDraftPlanDate(plan.planDate);
      setDraftBody(plan.body);
    }
  }, [plan]);

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

  function handleFlushSave() {
    commitSave({ name: draftName, planDate: draftPlanDate, body: draftBody });
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
        institutionJoinPending={institutionJoinPending}
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
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">
            {plan ? PLAN_TYPE_LABELS[plan.planType] : "Plan"}
          </p>
          <h1 className="truncate font-heading text-lg font-bold text-brand-prussian-blue">{draftName || "Untitled"}</h1>
        </div>
        <div className="flex-shrink-0">
          <SavedStateIndicator
            status={saveStatus}
            isDirty={isDirty}
            hasLoaded={!!plan}
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
        ) : !plan ? (
          <InlineErrorState message="This plan couldn't be found." onRetry={reload} />
        ) : (
          <div className="flex flex-col gap-5 lg:max-w-2xl">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="plan-name" className="text-sm font-semibold text-brand-neutral-black">
                Name
              </label>
              <input
                id="plan-name"
                value={draftName}
                onChange={(e) => {
                  setDraftName(e.target.value);
                  markChanged();
                }}
                onBlur={() => commitSave({ name: draftName })}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              />
            </div>

            <div className="flex flex-col gap-1.5 lg:w-64">
              <label htmlFor="plan-date" className="text-sm font-semibold text-brand-neutral-black">
                Date
              </label>
              <input
                id="plan-date"
                type="date"
                value={draftPlanDate}
                onChange={(e) => {
                  setDraftPlanDate(e.target.value);
                  markChanged();
                  commitSave({ planDate: e.target.value });
                }}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="plan-body" className="text-sm font-semibold text-brand-neutral-black">
                Summary
              </label>
              <textarea
                id="plan-body"
                value={draftBody}
                onChange={(e) => {
                  setDraftBody(e.target.value);
                  markChanged();
                }}
                onBlur={() => commitSave({ body: draftBody })}
                rows={10}
                placeholder="What this plan covers…"
                className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              />
            </div>

            <div>
              <p className="mb-1.5 text-sm font-semibold text-brand-neutral-black">Visible to school</p>
              <p className="-mt-0.5 mb-2 text-xs text-brand-neutral-black/50">
                The summary above, never the attachment below — that stays clinic-only regardless of this setting.
              </p>
              <div className="flex gap-2">
                {(
                  [
                    { value: null, label: "Type default (shareable)" },
                    { value: "shareable" as const, label: "Shareable" },
                    { value: "clinic_only" as const, label: "Clinic only" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => {
                      markChanged();
                      commitSave({ schoolVisibilityOverride: opt.value });
                    }}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                      plan.schoolVisibilityOverride === opt.value
                        ? "border-brand-prussian-blue bg-brand-pastel-blue/20 text-brand-prussian-blue"
                        : "border-black/10 bg-white text-brand-neutral-black"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <AttachmentsSection
              artefactId={plan.id}
              artefactType="clinical_plan"
              isLocked={false}
              helpText="The signed document, if there is one. Never visible to school staff — only this plan's own name, date and summary above are."
            />
          </div>
        )}
      </main>
    </div>
  );
}
