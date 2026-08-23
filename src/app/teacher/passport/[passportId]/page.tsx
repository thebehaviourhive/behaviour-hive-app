"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { getChildFirstName } from "@/lib/childDisplayName";
import { StrategyLedgerSheet } from "@/components/teacher/StrategyLedgerSheet";
import { ABCLogger } from "@/components/abc-logger/ABCLogger";
import { ABCTimeline } from "@/components/abc-logger/ABCTimeline";
import { usePassportClinicalContent } from "@/hooks/usePassportClinicalContent";
import { ClinicalTeamSection } from "@/components/passport/clinical-team/ClinicalTeamSection";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { ProgressSurface } from "@/components/progress/ProgressSurface";
import { TeacherPassportMessagesTab } from "@/components/teacher/TeacherPassportMessagesTab";
import { useMessageRecipientCandidates } from "@/hooks/useMessageRecipientCandidates";
import { useMessageCategories } from "@/hooks/useMessageCategories";
import { fetchApprovedInstitutionPhone } from "@/lib/messages/institutionPhone";
import { ComposeMessageSheet } from "@/components/messages/ComposeMessageSheet";

type TabKey =
  | "summary"
  | "behaviour"
  | "communication"
  | "supports"
  | "incidents"
  | "clinicalTeam"
  | "messages"
  | "progress";

const TABS: { key: TabKey; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "behaviour", label: "Behaviour Signals" },
  { key: "communication", label: "Communication" },
  { key: "supports", label: "Supports" },
  { key: "incidents", label: "Incidents" },
  { key: "clinicalTeam", label: "Clinical Team" },
  { key: "messages", label: "Messages" },
  { key: "progress", label: "Progress" },
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

export default function TeacherPassportPage() {
  const router = useRouter();
  const params = useParams<{ passportId: string }>();
  const passportId = params.passportId;
  const { user, isReady } = useRequireRole("class_teacher");
  const searchParams = useSearchParams();

  const [profile, setProfile] = useState<ClassroomProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Read once at mount, e.g. an incident-note message's "View log"
  // linking straight into ?tab=incidents (same convention as the
  // clinician passport page's own ?tab= deep-link).
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const requested = searchParams.get("tab");
    return TABS.some((t) => t.key === requested) ? (requested as TabKey) : "summary";
  });
  const [isLedgerOpen, setIsLedgerOpen] = useState(false);
  const [isAbcLoggerOpen, setIsAbcLoggerOpen] = useState(false);
  const [timelineRefreshKey, setTimelineRefreshKey] = useState(0);
  const [hasSubmittedEodToday, setHasSubmittedEodToday] = useState(false);
  // Stage 3A: the same deep-link's ?logId, handed to ABCTimeline to
  // scroll to and highlight that one card.
  const highlightAbcLogId = searchParams.get("logId");
  const [composeAbcLogId, setComposeAbcLogId] = useState<string | null>(null);
  const [messagesInstitutionPhone, setMessagesInstitutionPhone] = useState<string | null>(null);
  const { candidates: messageCandidates } = useMessageRecipientCandidates(passportId);
  const { categories: messageCategories } = useMessageCategories("class_teacher");
  const incidentNoteCategoryId = messageCategories.find((category) => category.label === "Incident note")?.id;
  // Teacher-logged -> the parent, per the brief's sensible default
  // (still adjustable via the compose sheet's normal recipient picker).
  const defaultIncidentRecipientIds = messageCandidates
    .filter((candidate) => candidate.role === "parent")
    .map((candidate) => candidate.recipientId);

  useEffect(() => {
    let isMounted = true;
    fetchApprovedInstitutionPhone(createClient(), passportId).then((phone) => {
      if (isMounted) setMessagesInstitutionPhone(phone);
    });
    return () => {
      isMounted = false;
    };
  }, [passportId]);

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

      // Explicit access guard, checked before anything else: a teacher
      // whose access has been revoked (or was never granted) must see the
      // clean "no access" state immediately, not fire five more queries
      // that RLS would filter to empty anyway. A bookmarked/history URL
      // is the exact path a revoked teacher would use to reach this page.
      const { data: access } = await supabase
        .from("passport_access")
        .select("is_active")
        .eq("passport_id", passportId)
        .eq("teacher_id", user!.id)
        .maybeSingle();

      if (!isMounted) return;

      if (!access?.is_active) {
        setIsLoading(false);
        return;
      }

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [
        { data: passport },
        { data: sectionB },
        { data: sectionC },
        { data: sectionD },
        { data: checkin },
        { data: todaysUpdate },
      ] = await Promise.all([
        supabase
          .from("passports")
          .select("child_name, diagnoses, diagnosis_other")
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
        supabase
          .from("teacher_updates")
          .select("id")
          .eq("passport_id", passportId)
          .eq("teacher_id", user!.id)
          .gte("submitted_at", startOfToday.toISOString())
          .limit(1)
          .maybeSingle(),
      ]);

      if (!isMounted) return;

      setHasSubmittedEodToday(Boolean(todaysUpdate));

      if (!passport) {
        setIsLoading(false);
        return;
      }

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
        beforeBehaviour: Array.isArray(sectionD?.before_behaviour)
          ? sectionD.before_behaviour
          : [],
        beforeBehaviourOther: sectionD?.before_behaviour_other ?? null,
        duringDistress: Array.isArray(sectionD?.during_distress)
          ? sectionD.during_distress
          : [],
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
              stressors: Array.isArray(checkin.morning_stressors)
                ? checkin.morning_stressors
                : [],
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
          onClick={() => router.push("/teacher/dashboard")}
          className="rounded-full border-2 border-brand-prussian-blue px-5 py-2.5 text-sm font-semibold text-brand-prussian-blue"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const isAfternoon = new Date().getHours() >= 13;

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
          onClick={() => router.push("/teacher/dashboard")}
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
              e.currentTarget.scrollIntoView({
                behavior: "smooth",
                inline: "center",
                block: "nearest",
              });
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
                {profile.todayContext.headsUp && (
                  <HeadsUpQuote text={profile.todayContext.headsUp} />
                )}
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
          </>
        )}

        {activeTab === "behaviour" && (
          <>
            <SectionHeading>The Smoke Signals</SectionHeading>
            <p className="-mt-2 text-sm text-black/50">
              Early warning signs that things are getting hard.
            </p>
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
          <ABCTimeline
            key={timelineRefreshKey}
            passportId={passportId}
            viewerRole="class_teacher"
            highlightLogId={highlightAbcLogId}
          />
        )}

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
              <ClinicalTeamSection items={clinicalContentItems} viewerRole="teacher" />
            )}
          </>
        )}

        {activeTab === "messages" && user && (
          <TeacherPassportMessagesTab
            passportId={passportId}
            childName={profile.childFirstName}
            userId={user.id}
          />
        )}

        {activeTab === "progress" && (
          <ProgressSurface passportId={passportId} childFullName={profile.childFirstName} role="teacher" />
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-black/5 bg-white p-4">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-2">
          {isAfternoon && (
            <button
              type="button"
              onClick={() => {
                if (!hasSubmittedEodToday) router.push(`/teacher/eod/${passportId}`);
              }}
              disabled={hasSubmittedEodToday}
              className={`w-full rounded-2xl py-3.5 text-sm font-semibold transition-colors ${
                hasSubmittedEodToday
                  ? "cursor-not-allowed bg-black/5 text-black/40"
                  : "bg-brand-golden-brown text-white shadow-sm"
              }`}
            >
              {hasSubmittedEodToday ? "Update Sent" : "Complete EOD Update"}
            </button>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsLedgerOpen(true)}
              className="flex-1 rounded-2xl bg-brand-prussian-blue py-3.5 text-sm font-semibold text-white shadow-sm"
            >
              + Add to Ledger
            </button>
            <button
              type="button"
              onClick={() => setIsAbcLoggerOpen(true)}
              className="flex-1 rounded-2xl bg-brand-golden-brown py-3.5 text-sm font-semibold text-white shadow-sm"
            >
              + Log ABC Incident
            </button>
          </div>
        </div>
      </div>

      {user && (
        <StrategyLedgerSheet
          isOpen={isLedgerOpen}
          onClose={() => setIsLedgerOpen(false)}
          passportId={passportId}
          userId={user.id}
        />
      )}

      {isAbcLoggerOpen && (
        <ABCLogger
          passportId={passportId}
          childName={profile.childFirstName}
          role="class_teacher"
          onOfferMessage={(newLogId) => setComposeAbcLogId(newLogId)}
          onComplete={() => {
            setIsAbcLoggerOpen(false);
            setTimelineRefreshKey((key) => key + 1);
            setActiveTab("incidents");
          }}
          onDismiss={() => setIsAbcLoggerOpen(false)}
        />
      )}

      {/* Stage 3A: "Also send a message about this?" */}
      {composeAbcLogId && incidentNoteCategoryId && (
        <ComposeMessageSheet
          isOpen={Boolean(composeAbcLogId)}
          onClose={() => setComposeAbcLogId(null)}
          passportId={passportId}
          childName={profile.childFirstName}
          candidates={messageCandidates}
          categories={messageCategories}
          institutionPhone={messagesInstitutionPhone}
          onSent={() => setTimelineRefreshKey((key) => key + 1)}
          initialCategoryId={incidentNoteCategoryId}
          initialRecipientIds={defaultIncidentRecipientIds}
          bodyPlaceholder="All settled now — just so you know…"
          abcLogId={composeAbcLogId}
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
  return (
    <h2 className="font-heading text-base font-semibold text-brand-neutral-black">
      {children}
    </h2>
  );
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
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-black/40">
        {label}
      </p>
      <p className="text-sm leading-relaxed text-brand-neutral-black">
        {text || "Not specified"}
      </p>
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
