"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { getChildFirstName } from "@/lib/childDisplayName";
import { ABCLogger } from "@/components/abc-logger/ABCLogger";
import { ABCTimeline } from "@/components/abc-logger/ABCTimeline";
import { usePassportClinicalContent } from "@/hooks/usePassportClinicalContent";
import { ClinicalTeamSection } from "@/components/passport/clinical-team/ClinicalTeamSection";
import { PassportCompletionSection } from "@/components/passport/PassportCompletionSection";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { ChildIncidentsTab } from "@/components/shared/ChildIncidentsTab";

// SNA's scoped passport view -- a deliberately narrower sibling of
// /teacher/passport/[passportId], not that page reused wholesale. Same
// tabs (Summary/Behaviour/Communication/Supports/ABC Logs/Incidents/
// Clinical Team, all backed by role-blind queries/RPCs that already
// correctly include SNA per migration 0065), but no Messages tab, no
// Progress tab, no EOD, and no "+ Add to Ledger" -- all explicitly
// excluded from the SNA v1 grant list. The footer is just "+ Log ABC
// Incident".
//
// Passport Incidents tabs (migration 0166) -- same mislabelling the
// teacher track had (an "Incidents" tab that was actually the ABC
// timeline), same fix: "incidents" stays what it was, relabelled "ABC
// Logs"; a genuinely separate "incidentLog" tab, labelled "Incidents",
// added for the real thing, via get_child_incidents_for_staff()
// (has_child_access() gated, same as the teacher track -- has_sna_
// access() is one of that function's own OR-branches, nothing new
// granted).
type TabKey = "summary" | "behaviour" | "communication" | "supports" | "incidents" | "incidentLog" | "clinicalTeam";

const TABS: { key: TabKey; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "behaviour", label: "Behaviour Signals" },
  { key: "communication", label: "Communication" },
  { key: "supports", label: "Supports" },
  { key: "incidents", label: "ABC Logs" },
  { key: "incidentLog", label: "Incidents" },
  { key: "clinicalTeam", label: "Clinical Team" },
];

const SLEEP_LABELS: Record<string, string> = {
  slept_through: "Slept through / Well rested",
  woke_briefly: "Woke up briefly",
  very_restless: "Very restless / Up multiple times",
  barely_slept: "Barely slept",
};

const REGULATION_LABELS: Record<string, string> = {
  settled: "Settled and Calm",
  unsettled: "A bit unsettled / Anxious",
  dysregulated: "Highly dysregulated / Upset",
};

interface TodayContext {
  sleepQuality: string | null;
  regulationState: string | null;
  stressors: string[] | null;
  headsUp: string | null;
}

interface ClassroomProfile {
  childFirstName: string;
  diagnoses: string[];
  diagnosisOther: string | null;
  communicationMethods: string[];
  communicationMethodsOther: string | null;
  showsHappy: string | null;
  showsAnxious: string | null;
  phrasesToAvoid: string | null;
  hardSignals: string[];
  hardSignalsOther: string | null;
  hardTriggers: string[];
  hardTriggersOther: string | null;
  beforeBehaviour: string[];
  beforeBehaviourOther: string | null;
  duringDistress: string[];
  duringDistressOther: string | null;
  afterDistress: string[];
  afterDistressOther: string | null;
  sensorySeeks: string[];
  sensorySeeksOther: string | null;
  sensoryAvoids: string[];
  sensoryAvoidsOther: string | null;
  todayContext: TodayContext | null;
}

export default function SnaPassportPage() {
  const router = useRouter();
  const params = useParams<{ passportId: string }>();
  const passportId = params.passportId;
  const { user, isReady } = useRequireRole("sna");
  const searchParams = useSearchParams();

  const [profile, setProfile] = useState<ClassroomProfile | null>(null);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [isSectionAComplete, setIsSectionAComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const requested = searchParams.get("tab");
    return TABS.some((t) => t.key === requested) ? (requested as TabKey) : "summary";
  });
  const [isAbcLoggerOpen, setIsAbcLoggerOpen] = useState(false);
  const [timelineRefreshKey, setTimelineRefreshKey] = useState(0);

  const {
    items: clinicalContentItems,
    isLoading: isLoadingClinicalContent,
    loadError: clinicalContentError,
    reload: reloadClinicalContent,
  } = usePassportClinicalContent(passportId);

  useEffect(() => {
    if (!isReady || !passportId || !user) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();

      // PRD 1, Stage 2 + 3 fix: this guard used to check ONLY
      // passport_access directly, the same narrow shape /sna/passports
      // itself had before useSnaChildren() -- found live, on the
      // deployed app, by tapping through from that already-fixed list
      // into a "Covering today" child and landing on "we couldn't find
      // this classroom profile." The list surfaced the child; the
      // detail page it linked to used a different, older access check
      // that had never heard of child_assignments or temporary_access.
      // has_sna_access(user_id, passport_id) is the single source of
      // truth for all three -- the same function RLS itself calls, so
      // this guard and the actual data queries below can never disagree
      // about who has access, unlike the old direct-table check.
      const { data: hasAccess } = await supabase.rpc("has_sna_access", {
        p_user_id: user!.id,
        p_passport_id: passportId,
      });

      if (!isMounted) return;

      if (!hasAccess) {
        setIsLoading(false);
        return;
      }

      // PRD 3, Stage 3 -- request_passport_completion() needs this
      // SNA's own institution_id. has_sna_access() (above) covers direct
      // grants, 1:1 assignment, temporary cover, and class-tier access,
      // but only a direct passport_access grant satisfies the RPC's own
      // narrower issuing gate -- a covering SNA can still view this
      // page, correctly, but a request tap will get the RPC's own
      // honest refusal rather than silently doing nothing.
      const { data: staffRow } = await supabase
        .from("institution_staff")
        .select("institution_id")
        .eq("user_id", user!.id)
        .is("deactivated_at", null)
        .maybeSingle();
      if (isMounted && staffRow) {
        setInstitutionId(staffRow.institution_id);
      }

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [
        { data: passport },
        { data: sectionB },
        { data: sectionC },
        { data: sectionD },
        { data: checkin },
      ] = await Promise.all([
        supabase
          .from("passports")
          .select("child_name, diagnoses, diagnosis_other, section_a_complete")
          .eq("id", passportId)
          .maybeSingle(),
        supabase
          .from("passport_section_b")
          .select("hard_signals, hard_signals_other, hard_triggers, hard_triggers_other")
          .eq("passport_id", passportId)
          .maybeSingle(),
        supabase
          .from("passport_section_c")
          .select(
            "communication_methods, communication_methods_other, shows_happy, shows_anxious, phrases_to_avoid"
          )
          .eq("passport_id", passportId)
          .maybeSingle(),
        supabase
          .from("passport_section_d")
          .select(
            "before_behaviour, before_behaviour_other, during_distress, during_distress_other, after_distress, after_distress_other, sensory_seeks, sensory_seeks_other, sensory_avoids, sensory_avoids_other"
          )
          .eq("passport_id", passportId)
          .maybeSingle(),
        supabase
          .from("morning_checkins")
          .select("sleep_quality, regulation_state, morning_stressors, heads_up, checked_in_at")
          .eq("passport_id", passportId)
          .gte("checked_in_at", startOfToday.toISOString())
          .order("checked_in_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (!isMounted) return;

      if (!passport) {
        setIsLoading(false);
        return;
      }

      setIsSectionAComplete(Boolean(passport.section_a_complete));

      setProfile({
        childFirstName: getChildFirstName(passport.child_name),
        diagnoses: Array.isArray(passport.diagnoses) ? passport.diagnoses : [],
        diagnosisOther: passport.diagnosis_other,
        communicationMethods: Array.isArray(sectionC?.communication_methods)
          ? sectionC.communication_methods
          : [],
        communicationMethodsOther: sectionC?.communication_methods_other ?? null,
        showsHappy: sectionC?.shows_happy ?? null,
        showsAnxious: sectionC?.shows_anxious ?? null,
        phrasesToAvoid: sectionC?.phrases_to_avoid ?? null,
        hardSignals: Array.isArray(sectionB?.hard_signals) ? sectionB.hard_signals : [],
        hardSignalsOther: sectionB?.hard_signals_other ?? null,
        hardTriggers: Array.isArray(sectionB?.hard_triggers) ? sectionB.hard_triggers : [],
        hardTriggersOther: sectionB?.hard_triggers_other ?? null,
        beforeBehaviour: Array.isArray(sectionD?.before_behaviour) ? sectionD.before_behaviour : [],
        beforeBehaviourOther: sectionD?.before_behaviour_other ?? null,
        duringDistress: Array.isArray(sectionD?.during_distress) ? sectionD.during_distress : [],
        duringDistressOther: sectionD?.during_distress_other ?? null,
        afterDistress: Array.isArray(sectionD?.after_distress) ? sectionD.after_distress : [],
        afterDistressOther: sectionD?.after_distress_other ?? null,
        sensorySeeks: Array.isArray(sectionD?.sensory_seeks) ? sectionD.sensory_seeks : [],
        sensorySeeksOther: sectionD?.sensory_seeks_other ?? null,
        sensoryAvoids: Array.isArray(sectionD?.sensory_avoids) ? sectionD.sensory_avoids : [],
        sensoryAvoidsOther: sectionD?.sensory_avoids_other ?? null,
        todayContext: checkin
          ? {
              sleepQuality: checkin.sleep_quality,
              regulationState: checkin.regulation_state,
              stressors: Array.isArray(checkin.morning_stressors) ? checkin.morning_stressors : [],
              headsUp: checkin.heads_up,
            }
          : null,
      });
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [isReady, passportId, user]);

  if (!isReady || isLoading) {
    return null;
  }

  if (!profile) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-brand-off-white/40 px-4 text-center">
        <p className="text-sm text-black/60">
          We couldn&apos;t find this classroom profile, or you don&apos;t have
          access to it.
        </p>
        <button
          type="button"
          onClick={() => router.push("/sna/passports")}
          className="rounded-full border-2 border-brand-prussian-blue px-5 py-2.5 text-sm font-semibold text-brand-prussian-blue"
        >
          Back to Passports
        </button>
      </div>
    );
  }

  const diagnosisTags = profile.diagnoses.includes("Other") && profile.diagnosisOther
    ? [...profile.diagnoses.filter((d) => d !== "Other"), profile.diagnosisOther]
    : profile.diagnoses;

  const communicationTags = profile.communicationMethods.includes("Other") && profile.communicationMethodsOther
    ? [...profile.communicationMethods.filter((m) => m !== "Other"), profile.communicationMethodsOther]
    : profile.communicationMethods;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-28">
      <header className="px-4 pt-6 pb-3">
        <button
          type="button"
          onClick={() => router.push("/sna/passports")}
          aria-label="Back"
          className="mb-2 text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </button>
        <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
          {profile.childFirstName}&apos;s Classroom Profile
        </h1>
      </header>

      <div className="flex gap-1 overflow-x-auto border-b border-black/5 px-4">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={(e) => {
              setActiveTab(tab.key);
              e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
            }}
            className={`flex-shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
              activeTab === tab.key
                ? "border-brand-prussian-blue text-brand-prussian-blue"
                : "border-transparent text-black/40"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        {activeTab === "summary" && (
          <>
            <SectionHeading>Today&apos;s Context</SectionHeading>
            {profile.todayContext ? (
              <div className="flex flex-col gap-2 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                <InfoRow
                  label="Sleep"
                  value={
                    profile.todayContext.sleepQuality
                      ? SLEEP_LABELS[profile.todayContext.sleepQuality]
                      : "Not specified"
                  }
                />
                <InfoRow
                  label="Regulation"
                  value={
                    profile.todayContext.regulationState
                      ? REGULATION_LABELS[profile.todayContext.regulationState]
                      : "Not specified"
                  }
                />
                {profile.todayContext.stressors && profile.todayContext.stressors.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold text-black/40">Stressors</p>
                    <PillRow items={profile.todayContext.stressors} />
                  </div>
                )}
                {profile.todayContext.headsUp && <HeadsUpQuote text={profile.todayContext.headsUp} />}
              </div>
            ) : (
              <EmptyCard text="No morning check-in received today." />
            )}

            <SectionHeading>Profile</SectionHeading>
            {diagnosisTags.length > 0 ? (
              <PillRow items={diagnosisTags} tone="warm" />
            ) : (
              <EmptyCard text="No diagnosis information provided." />
            )}

            <SectionHeading>Key Communication</SectionHeading>
            {communicationTags.length > 0 ? (
              <PillRow items={communicationTags} tone="warm" />
            ) : (
              <EmptyCard text="No communication methods provided." />
            )}

            {/* PRD 3, Stage 3 -- CORRECTED. Not a new content section --
                the answer is Section A itself, already rendered above
                ("Profile"/"Key Communication") once a guardian fills it
                in. This is just the ask-and-track action. */}
            <SectionHeading>Passport Completion</SectionHeading>
            {institutionId && (
              <PassportCompletionSection
                passportId={passportId}
                institutionId={institutionId}
                sectionAComplete={isSectionAComplete}
              />
            )}
          </>
        )}

        {activeTab === "behaviour" && (
          <>
            <SectionHeading>The Smoke Signals</SectionHeading>
            <p className="-mt-2 text-sm text-black/50">Early warning signs that things are getting hard.</p>
            <CardList
              items={appendOther(profile.hardSignals, profile.hardSignalsOther)}
              emptyText="No early warning signs recorded yet."
            />

            <SectionHeading>The Fuse</SectionHeading>
            <p className="-mt-2 text-sm text-black/50">Common triggers to watch for.</p>
            <CardList
              items={appendOther(profile.hardTriggers, profile.hardTriggersOther)}
              emptyText="No triggers recorded yet."
            />
          </>
        )}

        {activeTab === "communication" && (
          <>
            <SectionHeading>Communication Methods</SectionHeading>
            {communicationTags.length > 0 ? (
              <PillRow items={communicationTags} tone="warm" />
            ) : (
              <EmptyCard text="No communication methods provided." />
            )}

            <TextCard label="How they show they're happy" text={profile.showsHappy} />
            <TextCard label="How they show they're anxious" text={profile.showsAnxious} />
            <TextCard label="Phrases or approaches to avoid" text={profile.phrasesToAvoid} />
          </>
        )}

        {activeTab === "supports" && (
          <>
            <SectionHeading>What Helps Before</SectionHeading>
            <CardList
              items={appendOther(profile.beforeBehaviour, profile.beforeBehaviourOther)}
              emptyText="Nothing recorded yet."
            />

            <SectionHeading>What Helps During Distress</SectionHeading>
            <CardList
              items={appendOther(profile.duringDistress, profile.duringDistressOther)}
              emptyText="Nothing recorded yet."
            />

            <SectionHeading>What Helps After Distress</SectionHeading>
            <CardList
              items={appendOther(profile.afterDistress, profile.afterDistressOther)}
              emptyText="Nothing recorded yet."
            />

            <SectionHeading>Sensory Seeks</SectionHeading>
            <CardList
              items={appendOther(profile.sensorySeeks, profile.sensorySeeksOther)}
              emptyText="Nothing recorded yet."
            />

            <SectionHeading>Sensory Avoids</SectionHeading>
            <CardList
              items={appendOther(profile.sensoryAvoids, profile.sensoryAvoidsOther)}
              emptyText="Nothing recorded yet."
            />
          </>
        )}

        {activeTab === "incidents" && (
          <ABCTimeline key={timelineRefreshKey} passportId={passportId} viewerRole="sna" />
        )}

        {activeTab === "incidentLog" && <ChildIncidentsTab passportId={passportId} />}

        {activeTab === "clinicalTeam" && (
          <>
            {isLoadingClinicalContent ? (
              <div className="flex flex-col gap-2">
                <div className="h-20 animate-pulse rounded-2xl bg-white" />
                <div className="h-20 animate-pulse rounded-2xl bg-white" />
              </div>
            ) : clinicalContentError ? (
              <InlineErrorState message={clinicalContentError} onRetry={reloadClinicalContent} />
            ) : clinicalContentItems.length === 0 ? (
              <EmptyCard text="Nothing from the clinical team yet." />
            ) : (
              <ClinicalTeamSection items={clinicalContentItems} viewerRole="sna" />
            )}
          </>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-black/5 bg-white p-4">
        <div className="mx-auto flex w-full max-w-sm">
          <button
            type="button"
            onClick={() => setIsAbcLoggerOpen(true)}
            className="w-full rounded-2xl bg-brand-golden-brown py-3.5 text-sm font-semibold text-white shadow-sm"
          >
            + Log ABC Incident
          </button>
        </div>
      </div>

      {isAbcLoggerOpen && (
        <ABCLogger
          passportId={passportId}
          childName={profile.childFirstName}
          role="sna"
          onComplete={() => {
            setIsAbcLoggerOpen(false);
            setTimelineRefreshKey((key) => key + 1);
            setActiveTab("incidents");
          }}
          onDismiss={() => setIsAbcLoggerOpen(false)}
        />
      )}
    </div>
  );
}

function appendOther(items: string[], other: string | null): string[] {
  if (!other) return items;
  return [...items, other];
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="font-heading text-base font-semibold text-brand-neutral-black">{children}</h2>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-sm text-black/70">
      <span className="font-semibold text-black/50">{label}: </span>
      {value}
    </p>
  );
}

function PillRow({ items, tone = "cool" }: { items: string[]; tone?: "cool" | "warm" }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
            tone === "warm"
              ? "bg-brand-safe-ivory/60 text-brand-neutral-black"
              : "bg-brand-pastel-blue/20 text-brand-prussian-blue"
          }`}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function CardList({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (items.length === 0) {
    return <EmptyCard text={emptyText} />;
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div
          key={item}
          className="rounded-2xl border border-black/5 bg-white px-4 py-3 text-sm font-medium text-brand-neutral-black shadow-sm"
        >
          {item}
        </div>
      ))}
    </div>
  );
}

function TextCard({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/40">{label}</p>
      <p className="text-sm leading-relaxed text-brand-neutral-black">{text || "Not specified"}</p>
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-sm text-black/50">
      {text}
    </div>
  );
}

function HeadsUpQuote({ text }: { text: string }) {
  return (
    <div className="relative mt-1 rounded-xl bg-brand-safe-ivory/50 py-2.5 pl-9 pr-3">
      <span aria-hidden className="absolute left-2.5 top-2.5 text-sm leading-none">
        💬
      </span>
      <p className="text-xs italic text-brand-neutral-black/80">{text}</p>
    </div>
  );
}
