"use client";

import { useEffect, useMemo } from "react";
import { format } from "date-fns";
import { useAbcLogs } from "@/hooks/useAbcLogs";
import { useIncidents } from "@/hooks/useIncidents";
import { useDailyPatterns } from "@/hooks/useDailyPatterns";
import { countByFunction, tallyAntecedents, tallyBehaviours, tallyConsequences } from "@/lib/fba/abcAnalysis";
import { NarrativeField } from "../NarrativeField";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { HorizontalBarChart } from "../charts/HorizontalBarChart";
import { PieChart } from "../charts/PieChart";
import { AbcIncidentCard } from "./direct/AbcIncidentCard";
import { DailyPatternsPanel } from "./direct/DailyPatternsPanel";
import { IncidentSummaryCard } from "@/components/clinician/incidents/IncidentSummaryCard";
import type { AbcHypothesisedFunction } from "@/lib/fba/types";
import type { FbaSectionBodyProps } from "./types";

export function DirectAssessmentSection({
  passportId,
  content,
  onFieldChange,
  onFieldBlur,
  onStructuralChange,
  readOnly,
}: FbaSectionBodyProps & { passportId: string }) {
  const { logs, isLoading, loadError } = useAbcLogs(passportId);
  const { incidents, isLoading: isLoadingIncidents, loadError: incidentsLoadError } = useIncidents(passportId);
  const {
    checkins: dailyCheckins,
    updates: dailyUpdates,
    isLoading: isLoadingDailyPatterns,
    loadError: dailyPatternsError,
  } = useDailyPatterns(passportId);

  const hasRange = Boolean(content.abcRangeStart && content.abcRangeEnd);
  const filteredLogs = useMemo(() => {
    if (!hasRange) return [];
    return logs.filter(
      (log) => log.incidentDate >= content.abcRangeStart! && log.incidentDate <= content.abcRangeEnd!
    );
  }, [logs, hasRange, content.abcRangeStart, content.abcRangeEnd]);

  // Separate window from the ABC range above -- see types.ts's own
  // comment on incidentRangeStart/End.
  const hasIncidentRange = Boolean(content.incidentRangeStart && content.incidentRangeEnd);
  const filteredIncidents = useMemo(() => {
    if (!hasIncidentRange) return [];
    // occurredAt is a full timestamptz, not a plain date like ABC logs'
    // incidentDate above -- comparing the whole string against a bare
    // YYYY-MM-DD range bound would wrongly exclude anything on the end
    // date itself (a longer string that starts with the shorter bound
    // sorts after it lexicographically). Compare the date portion only.
    return incidents.filter((incident) => {
      const occurredDate = incident.occurredAt.slice(0, 10);
      return occurredDate >= content.incidentRangeStart! && occurredDate <= content.incidentRangeEnd!;
    });
  }, [incidents, hasIncidentRange, content.incidentRangeStart, content.incidentRangeEnd]);

  const tags = content.abcFunctionTags ?? {};

  // Same denormalization rationale as Section 7's indirectAssessmentSummary
  // -- getSectionCompleteness has no DB access, so a summary is mirrored
  // into content_data whenever it genuinely changes.
  useEffect(() => {
    if (isLoading || !hasRange) return;
    const fresh = {
      totalLogsInRange: filteredLogs.length,
      taggedCount: filteredLogs.filter((log) => tags[log.id]).length,
    };
    const current = content.abcAnalysisSummary;
    if (current?.totalLogsInRange === fresh.totalLogsInRange && current?.taggedCount === fresh.taggedCount) {
      return;
    }
    onStructuralChange({ ...content, abcAnalysisSummary: fresh });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredLogs, isLoading, hasRange]);

  function updateTag(logId: string, tag: AbcHypothesisedFunction | undefined) {
    const nextTags = { ...tags };
    if (tag) {
      nextTags[logId] = tag;
    } else {
      delete nextTags[logId];
    }
    onStructuralChange({ ...content, abcFunctionTags: nextTags });
  }

  const functionBars = countByFunction(filteredLogs, tags);
  const antecedentTally = tallyAntecedents(filteredLogs);
  const behaviourTally = tallyBehaviours(filteredLogs);
  const consequenceTally = tallyConsequences(filteredLogs);
  const taggedCount = filteredLogs.filter((log) => tags[log.id]).length;

  return (
    <div className="flex flex-col gap-6">
      <NarrativeField
        label="On-Site Observations"
        value={content.onSiteObservations ?? ""}
        onChange={(next) => onFieldChange({ ...content, onSiteObservations: next })}
        onBlur={onFieldBlur}
        readOnly={readOnly}
        rows={8}
      />
      <NarrativeField
        label="Community Participation & Leisure"
        value={content.communityParticipation ?? ""}
        onChange={(next) => onFieldChange({ ...content, communityParticipation: next })}
        onBlur={onFieldBlur}
        readOnly={readOnly}
        rows={8}
      />

      <div>
        <p className="mb-2 font-heading text-base font-bold text-brand-neutral-black">ABC Data Analysis</p>

        {!readOnly && (
          <div className="mb-4 flex gap-3">
            <div className="flex-1">
              <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">From</label>
              <input
                type="date"
                value={content.abcRangeStart ?? ""}
                onChange={(e) => onStructuralChange({ ...content, abcRangeStart: e.target.value })}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">To</label>
              <input
                type="date"
                value={content.abcRangeEnd ?? ""}
                onChange={(e) => onStructuralChange({ ...content, abcRangeEnd: e.target.value })}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              />
            </div>
          </div>
        )}

        {readOnly && hasRange && (
          <p className="mb-4 text-sm text-brand-neutral-black/60">
            {format(new Date(content.abcRangeStart!), "d MMM yyyy")} –{" "}
            {format(new Date(content.abcRangeEnd!), "d MMM yyyy")}
          </p>
        )}

        {!hasRange ? (
          <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
            <p className="text-sm text-brand-neutral-black/70">
              {readOnly
                ? "No assessment date range was set."
                : "Set a date range to pull incidents from this child's ABC log."}
            </p>
          </div>
        ) : isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-brand-off-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-brand-off-white" />
          </div>
        ) : loadError ? (
          <InlineErrorState message={loadError} onRetry={() => window.location.reload()} />
        ) : filteredLogs.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
            <p className="text-sm text-brand-neutral-black/70">No incidents logged in this range.</p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm font-semibold text-brand-neutral-black/60">
              {taggedCount} of {filteredLogs.length} incidents tagged
            </p>

            <div className="mb-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
              <p className="mb-3 text-sm font-bold text-brand-neutral-black">Function Frequency</p>
              <HorizontalBarChart bars={functionBars} />
            </div>

            {/* Clinical convention: Antecedent -> Behaviour -> Consequence. */}
            <div className="mb-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
              <p className="mb-3 text-sm font-bold text-brand-neutral-black">Antecedents</p>
              <PieChart data={antecedentTally} />
            </div>

            <div className="mb-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
              <p className="mb-3 text-sm font-bold text-brand-neutral-black">Behaviours</p>
              <PieChart data={behaviourTally} />
            </div>

            <div className="mb-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
              <p className="mb-3 text-sm font-bold text-brand-neutral-black">Consequences</p>
              <PieChart data={consequenceTally} />
            </div>

            <div className="flex flex-col gap-2">
              {filteredLogs.map((log) => (
                <AbcIncidentCard
                  key={log.id}
                  log={log}
                  tag={tags[log.id]}
                  onTagChange={(tag) => updateTag(log.id, tag)}
                  readOnly={readOnly}
                />
              ))}
            </div>
          </>
        )}

      </div>

      <div>
        <p className="mb-2 font-heading text-base font-bold text-brand-neutral-black">Incident Log</p>

        {!readOnly && (
          <div className="mb-4 flex gap-3">
            <div className="flex-1">
              <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">From</label>
              <input
                type="date"
                value={content.incidentRangeStart ?? ""}
                onChange={(e) => onStructuralChange({ ...content, incidentRangeStart: e.target.value })}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">To</label>
              <input
                type="date"
                value={content.incidentRangeEnd ?? ""}
                onChange={(e) => onStructuralChange({ ...content, incidentRangeEnd: e.target.value })}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              />
            </div>
          </div>
        )}

        {readOnly && hasIncidentRange && (
          <p className="mb-4 text-sm text-brand-neutral-black/60">
            {format(new Date(content.incidentRangeStart!), "d MMM yyyy")} –{" "}
            {format(new Date(content.incidentRangeEnd!), "d MMM yyyy")}
          </p>
        )}

        {!hasIncidentRange ? (
          <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
            <p className="text-sm text-brand-neutral-black/70">
              {readOnly
                ? "No incident log date range was set."
                : "Set a date range to pull incidents from this child's Incident Log."}
            </p>
          </div>
        ) : isLoadingIncidents ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-brand-off-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-brand-off-white" />
          </div>
        ) : incidentsLoadError ? (
          <InlineErrorState message={incidentsLoadError} onRetry={() => window.location.reload()} />
        ) : filteredIncidents.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
            <p className="text-sm text-brand-neutral-black/70">No incident log records in this range.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredIncidents.map((incident) => (
              <IncidentSummaryCard key={incident.incidentId} incident={incident} />
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 font-heading text-base font-bold text-brand-neutral-black">Daily Patterns</p>
        {!hasRange ? (
          <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
            <p className="text-sm text-brand-neutral-black/70">
              {readOnly
                ? "No assessment date range was set."
                : "Set the date range above to pull morning check-ins and end-of-day updates."}
            </p>
          </div>
        ) : isLoadingDailyPatterns ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-brand-off-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-brand-off-white" />
          </div>
        ) : dailyPatternsError ? (
          <InlineErrorState message={dailyPatternsError} onRetry={() => window.location.reload()} />
        ) : (
          <DailyPatternsPanel
            checkins={dailyCheckins}
            updates={dailyUpdates}
            rangeStart={content.abcRangeStart!}
            rangeEnd={content.abcRangeEnd!}
          />
        )}
      </div>

      <NarrativeField
        label="ABC Interpretation"
        value={content.abcInterpretation ?? ""}
        onChange={(next) => onFieldChange({ ...content, abcInterpretation: next })}
        onBlur={onFieldBlur}
        readOnly={readOnly}
        rows={6}
        placeholder="Interpretation of the ABC data above…"
      />
    </div>
  );
}
