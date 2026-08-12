"use client";

import { useMemo, useState } from "react";
import { useDailyPatterns } from "@/hooks/useDailyPatterns";
import { useAbcTrendData } from "@/hooks/useAbcTrendData";
import { usePassportClinicalContent } from "@/hooks/usePassportClinicalContent";
import { getChildDisplayName, getChildFirstName } from "@/lib/childDisplayName";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import {
  buildCalendar,
  computeStreaks,
  summarizeByWeekday,
  summarizeDistribution,
  countDataDays,
  type DayEntry,
} from "@/lib/progress/regulation";
import { comparePeriods, evaluateComparisonAvailability, parentDistributionToneCopy, professionalDistributionToneCopy } from "@/lib/progress/comparison";
import {
  buildFrequencyBuckets,
  summarizeIncidentsByWeekday,
  tallyCategory,
  compareFrequency,
  parentFrequencyToneCopy,
  professionalFrequencyToneCopy,
  type AbcCategoryKind,
  type CategoryTally,
} from "@/lib/progress/abc";
import { compareFlagTrends, currentFlagCounts, type FlagDayEntry } from "@/lib/progress/flags";
import { strategyMarkerDates } from "@/lib/progress/strategyMarkers";
import { buildCrossSettingBuckets } from "@/lib/progress/crossSetting";
import { daysBetweenInclusive, todayLocalDateString } from "@/lib/progress/dateUtils";
import { meetsThreshold, resolveRange, type DateRange, type ProgressRangeKey } from "@/lib/progress/range";
import { sparseDataCopy, singleSourceCopy, zeroDataCopy } from "@/lib/progress/emptyStateCopy";
import type { ProgressViewerRole } from "@/lib/progress/types";
import { RangeSelector } from "./RangeSelector";
import { CustomDateRangeInputs } from "./CustomDateRangeInputs";
import { RegulationCalendar } from "./RegulationCalendar";
import { RegulationStackedBar } from "./RegulationStackedBar";
import { DayOfWeekPattern } from "./DayOfWeekPattern";
import { StreakCard } from "./StreakCard";
import { ProgressEmptyState } from "./ProgressEmptyState";
import { AbcFrequencyChart } from "./AbcFrequencyChart";
import { AbcDayOfWeekChart } from "./AbcDayOfWeekChart";
import { AbcCategoryBreakdown } from "./AbcCategoryBreakdown";
import { FlagTrendList } from "./FlagTrendList";
import { ClinicianFunctionSection } from "./ClinicianFunctionSection";
import { CrossSettingComparison } from "./CrossSettingComparison";

// Card wrapper matching the established chart-card convention (see
// DirectAssessmentSection.tsx): rounded-2xl border bg-white shadow-sm,
// with a font-heading-adjacent bold title above the chart.
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-bold text-brand-neutral-black">{title}</p>
      {children}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="h-16 animate-pulse rounded-2xl bg-brand-off-white" />
      <div className="h-16 animate-pulse rounded-2xl bg-brand-off-white" />
      <div className="h-16 animate-pulse rounded-2xl bg-brand-off-white" />
    </div>
  );
}

// The shared engine behind all three role surfaces (constraint A2):
// mounted as a full page for the parent, and as tab content within the
// existing teacher/clinician scoped passport views. Every read here
// goes through useDailyPatterns, which is a plain RLS-scoped Supabase
// query with zero role-specific logic of its own -- what each role
// actually receives is entirely governed by the existing table
// policies, not by anything this component decides.
export function ProgressSurface({
  passportId,
  childFullName,
  role,
}: {
  passportId: string;
  childFullName: string | null;
  role: ProgressViewerRole;
}) {
  const { checkins, updates, isLoading, loadError } = useDailyPatterns(passportId);
  const { entries: abcEntries } = useAbcTrendData(passportId);
  const { items: clinicalContentItems } = usePassportClinicalContent(passportId);
  const [rangeKey, setRangeKey] = useState<ProgressRangeKey>("7");
  // Stage C, clinician lens only -- RangeSelector never offers "custom"
  // to parent/teacher, so this state is simply unused (never read into
  // resolveRange) for those roles rather than needing its own guard.
  const [customRange, setCustomRange] = useState<DateRange | null>(null);

  const childFirstName = getChildFirstName(childFullName);
  const headerName = role === "teacher" ? getChildDisplayName(childFullName) : childFirstName;

  const morningEntries: DayEntry[] = useMemo(
    () => checkins.map((c) => ({ date: c.date, state: c.state })),
    [checkins]
  );
  const afternoonEntries: DayEntry[] = useMemo(
    () => updates.map((u) => ({ date: u.date, state: u.state })),
    [updates]
  );

  const earliestDataDate = useMemo(() => {
    const dates = [...morningEntries, ...afternoonEntries].map((e) => e.date);
    return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
  }, [morningEntries, afternoonEntries]);

  const today = todayLocalDateString();
  const range = resolveRange(rangeKey, earliestDataDate, today, customRange);
  const periodLength = daysBetweenInclusive(range.start, range.end);

  const hasAnyDataEver = checkins.length > 0 || updates.length > 0;
  const hasAfternoonData = updates.length > 0;
  const currentPeriodDataDays = countDataDays(morningEntries, range);
  const isSparse = hasAnyDataEver && rangeKey !== "all" && !meetsThreshold(currentPeriodDataDays, periodLength);

  const calendar = useMemo(() => buildCalendar(morningEntries, afternoonEntries, range), [morningEntries, afternoonEntries, range]);
  const distribution = useMemo(() => summarizeDistribution(morningEntries, range), [morningEntries, range]);
  const weekdayPattern = useMemo(() => summarizeByWeekday(morningEntries, range), [morningEntries, range]);
  const streaks = useMemo(() => computeStreaks(morningEntries, today), [morningEntries, today]);
  const comparisonAvailability = useMemo(
    () => evaluateComparisonAvailability(morningEntries, range),
    [morningEntries, range]
  );
  const comparison = useMemo(() => comparePeriods(morningEntries, range), [morningEntries, range]);

  // Stage B: ABC frequency/day-of-week/categorical charts -- reads
  // through useAbcTrendData (migration 0051), safe for all three roles
  // since that RPC structurally never returns perceived_function.
  const frequencyBuckets = useMemo(() => buildFrequencyBuckets(abcEntries, range), [abcEntries, range]);
  const incidentWeekdayPattern = useMemo(() => summarizeIncidentsByWeekday(abcEntries, range), [abcEntries, range]);
  const categoryTallies: Record<AbcCategoryKind, CategoryTally[]> = useMemo(
    () => ({
      antecedents: tallyCategory(abcEntries, range, "antecedents"),
      behaviours: tallyCategory(abcEntries, range, "behaviours"),
      consequences: tallyCategory(abcEntries, range, "consequences"),
    }),
    [abcEntries, range]
  );
  const frequencyComparison = useMemo(
    () => compareFrequency(abcEntries, range, comparisonAvailability),
    [abcEntries, range, comparisonAvailability]
  );
  const hasAnyAbcData = abcEntries.length > 0;

  // Flag trends -- flags already come back from useDailyPatterns
  // (teacher_updates.flags), so no new query. Rising/fading gated by the
  // same comparison-availability signal as every other Progress trend;
  // falls back to a plain current-period tally (no direction claimed)
  // when that gate isn't clear.
  const flagEntries: FlagDayEntry[] = useMemo(() => updates.map((u) => ({ date: u.date, flags: u.flags })), [updates]);
  const flagTrends = useMemo(
    () => compareFlagTrends(flagEntries, range, comparisonAvailability.available),
    [flagEntries, range, comparisonAvailability]
  );
  const flagFallback = useMemo(() => currentFlagCounts(flagEntries, range), [flagEntries, range]);

  // Strategy marker dates -- reads through usePassportClinicalContent,
  // already role-scoped exactly as constraint 2 requires (teacher only
  // ever receives strategy_school/strategy_shared/trigger/setting_event
  // rows from that RPC). Multiple distinct publication dates = multiple
  // markers.
  const strategyDates = useMemo(() => strategyMarkerDates(clinicalContentItems, range), [clinicalContentItems, range]);

  // Stage C, clinician lens only -- reuses the exact same bucket
  // boundaries as the ABC frequency chart (buildDateBuckets) so home/
  // school/incidents line up against one shared timeline.
  const crossSettingBuckets = useMemo(
    () => buildCrossSettingBuckets(morningEntries, afternoonEntries, abcEntries, range),
    [morningEntries, afternoonEntries, abcEntries, range]
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">{headerName}&apos;s Progress</h1>
      </div>

      {loadError ? (
        <InlineErrorState message={loadError} onRetry={() => window.location.reload()} />
      ) : isLoading ? (
        <ChartSkeleton />
      ) : !hasAnyDataEver ? (
        <ProgressEmptyState icon="🌱" {...zeroDataCopy(role, childFirstName)} />
      ) : (
        <>
          <RangeSelector value={rangeKey} onChange={setRangeKey} allowCustom={role === "clinician"} />

          {role === "clinician" && rangeKey === "custom" && (
            <CustomDateRangeInputs value={customRange} onChange={setCustomRange} />
          )}

          {isSparse && <ProgressEmptyState icon="📈" full={false} {...sparseDataCopy(role, comparisonAvailability.moreNeededForCurrent)} />}

          <ChartCard title="Regulation over time">
            <RegulationCalendar days={calendar} hasAfternoonData={hasAfternoonData} strategyDates={strategyDates} />
          </ChartCard>

          {!hasAfternoonData && (
            <ProgressEmptyState icon="🔗" full={false} title="Only home data so far" body={singleSourceCopy(role, "teacher")} />
          )}

          <ChartCard title="State distribution">
            <RegulationStackedBar distribution={distribution} />
            {comparison && (
              <p className="mt-3 text-xs text-brand-neutral-black/70">
                {role === "parent" ? parentDistributionToneCopy(comparison) : professionalDistributionToneCopy(comparison)}
              </p>
            )}
          </ChartCard>

          <ChartCard title="Day-of-week pattern">
            <DayOfWeekPattern pattern={weekdayPattern} role={role} />
          </ChartCard>

          {role === "parent" && <StreakCard streaks={streaks} />}

          <ChartCard title="Incidents over time">
            {hasAnyAbcData ? (
              <>
                <AbcFrequencyChart buckets={frequencyBuckets} strategyDates={strategyDates} />
                {frequencyComparison && (
                  <p className="mt-3 text-xs text-brand-neutral-black/70">
                    {role === "parent"
                      ? parentFrequencyToneCopy(frequencyComparison)
                      : professionalFrequencyToneCopy(frequencyComparison)}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-brand-neutral-black/50">No incidents logged in this period.</p>
            )}
          </ChartCard>

          {hasAnyAbcData && (
            <>
              <ChartCard title="Incident day-of-week pattern">
                <AbcDayOfWeekChart pattern={incidentWeekdayPattern} />
              </ChartCard>

              <ChartCard title="What's happening around incidents">
                <AbcCategoryBreakdown tallies={categoryTallies} />
              </ChartCard>
            </>
          )}

          {role === "clinician" && <ClinicianFunctionSection passportId={passportId} range={range} />}

          {role === "clinician" && (
            <ChartCard title="Home vs school vs incidents">
              <CrossSettingComparison buckets={crossSettingBuckets} />
            </ChartCard>
          )}

          <ChartCard title="Flags">
            {flagTrends ? (
              <FlagTrendList trends={flagTrends} />
            ) : flagFallback.length > 0 ? (
              <FlagTrendList
                trends={flagFallback.map((f) => ({ flag: f.flag, current: f.count, previous: 0, direction: "steady" as const }))}
              />
            ) : (
              <p className="text-sm text-brand-neutral-black/50">No flags logged in this period.</p>
            )}
          </ChartCard>
        </>
      )}
    </div>
  );
}
