"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { ABCLogger } from "@/components/abc-logger/ABCLogger";
import { ABCTimeline } from "@/components/abc-logger/ABCTimeline";
import { usePassportClinicalContent } from "@/hooks/usePassportClinicalContent";
import { ClinicalTeamSection } from "@/components/passport/clinical-team/ClinicalTeamSection";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { ProgressSurface } from "@/components/progress/ProgressSurface";
import { useCalmButtonLiveStatus } from "@/hooks/useCalmButtonLiveStatus";
import { ClinicalFileFbaTab } from "@/components/clinician/fba/ClinicalFileFbaTab";
import { ClinicalFileMessagesTab } from "@/components/clinician/ClinicalFileMessagesTab";
import { ClinicalFileIncidentsTab } from "@/components/clinician/ClinicalFileIncidentsTab";
import { EffectivenessSurface } from "@/components/clinician/passport/EffectivenessSurface";
import { ReasonConfirmSheet } from "@/components/shared/ReasonConfirmSheet";

type TabKey =
  | "summary"
  | "behaviour"
  | "communication"
  | "supports"
  | "incidents"
  | "incidentLog"
  | "clinicalTeam"
  | "fba"
  | "messages"
  | "progress"
  | "effectiveness";

const TABS: { key: TabKey; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "behaviour", label: "Behaviour Signals" },
  { key: "communication", label: "Communication" },
  { key: "supports", label: "Supports" },
  { key: "incidents", label: "Incidents" },
  // Phase 5: distinct label/key from "Incidents" above on purpose --
  // that tab is the ABC log timeline (an unrelated, pre-existing
  // feature with an unfortunately overlapping name), this one is the
  // formal School Incident Log via get_clinician_incidents().
  { key: "incidentLog", label: "Incident Log" },
  { key: "clinicalTeam", label: "Clinical Team" },
  { key: "fba", label: "FBA" },
  { key: "messages", label: "Messages" },
  { key: "progress", label: "Progress" },
  { key: "effectiveness", label: "Effectiveness" },
];

interface ClinicalProfile {
  // Clinicians see the child's full name, unlike the redacted first-name
  // view teachers get -- clinical records require certainty of identity.
  // Deliberate product decision, pending clinical sign-off.
  childFullName: string;
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
}

export default function ClinicianPassportPage() {
  const router = useRouter();
  const params = useParams<{ passportId: string }>();
  const passportId = params.passportId;
  const { user, isReady } = useRequireRole("clinician");
  const searchParams = useSearchParams();

  const [profile, setProfile] = useState<ClinicalProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Stage 7, Step 2 -- this clinician's own engagement with this
  // passport, so they can see who connected them and end their own
  // involvement (self-revoke: "the clinician's own professional
  // decision, orthogonal to engaged_by -- always available regardless
  // of who engaged them", 0123). Resolved from get_clinician_passports()
  // rather than a direct clinician_access read -- one source of truth
  // for this relationship, same reasoning as the parent/principal pages.
  const [engagement, setEngagement] = useState<{
    clinicianAccessId: string;
    engagedBy: "parent" | "institution";
    engagedByInstitutionName: string | null;
  } | null>(null);
  const [isEndInvolvementOpen, setIsEndInvolvementOpen] = useState(false);
  // Read once at mount, e.g. from Strategy Insights' per-child drill-down
  // linking straight into ?tab=effectiveness -- a deliberate ONE-TIME
  // read (lazy initializer, not synced on every searchParams change), so
  // manually switching tabs afterwards behaves exactly as it always has
  // (plain local state, no URL sync back out). An invalid/unknown value
  // falls back to "summary" rather than rendering nothing.
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const requested = searchParams.get("tab");
    return TABS.some((t) => t.key === requested) ? (requested as TabKey) : "summary";
  });
  const [isAbcLoggerOpen, setIsAbcLoggerOpen] = useState(false);
  const [timelineRefreshKey, setTimelineRefreshKey] = useState(0);
  const { isLive: isCalmButtonLive, isLoading: isCalmStatusLoading } = useCalmButtonLiveStatus(passportId);
  const {
    items: clinicalContentItems,
    isLoading: isLoadingClinicalContent,
    loadError: clinicalContentError,
    reload: reloadClinicalContent,
  } = usePassportClinicalContent(passportId);

  useEffect(() => {
    if (!isReady || !passportId) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();

      const [{ data: passport }, { data: sectionB }, { data: sectionC }, { data: sectionD }, { data: clinicianPassports, error: clinicianPassportsError }] =
        await Promise.all([
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
          supabase.rpc("get_clinician_passports"),
        ]);

      if (!isMounted) return;

      if (clinicianPassportsError) {
        console.error("Failed to load own engagement:", clinicianPassportsError);
      } else {
        const own = (clinicianPassports ?? []).find(
          (row: { passport_id: string }) => row.passport_id === passportId
        );
        setEngagement(
          own
            ? {
                clinicianAccessId: own.clinician_access_id,
                engagedBy: own.engaged_by,
                engagedByInstitutionName: own.engaged_by_institution_name,
              }
            : null
        );
      }

      if (!passport) {
        setIsLoading(false);
        return;
      }

      setProfile({
        childFullName: passport.child_name,
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
        duringDistress: Array.isArray(sectionD?.during_distress) ? sectionD.during_distress : [],
        duringDistressOther: sectionD?.during_distress_other ?? null,
        afterDistress: Array.isArray(sectionD?.after_distress) ? sectionD.after_distress : [],
        afterDistressOther: sectionD?.after_distress_other ?? null,
        sensorySeeks: Array.isArray(sectionD?.sensory_seeks) ? sectionD.sensory_seeks : [],
        sensorySeeksOther: sectionD?.sensory_seeks_other ?? null,
        sensoryAvoids: Array.isArray(sectionD?.sensory_avoids) ? sectionD.sensory_avoids : [],
        sensoryAvoidsOther: sectionD?.sensory_avoids_other ?? null,
      });
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [isReady, passportId]);

  if (!isReady || isLoading) {
    return null;
  }

  if (!profile) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-brand-off-white/40 px-4 text-center">
        <p className="text-sm text-brand-neutral-black/70">
          We couldn&apos;t find this passport, or you don&apos;t have access to it.
        </p>
        <button
          type="button"
          onClick={() => router.push("/clinician/passports")}
          className="rounded-full border-2 border-brand-prussian-blue px-5 py-2.5 text-sm font-semibold text-brand-prussian-blue"
        >
          Back to Passports
        </button>
      </div>
    );
  }

  const diagnosisTags =
    profile.diagnoses.includes("Other") && profile.diagnosisOther
      ? [...profile.diagnoses.filter((d) => d !== "Other"), profile.diagnosisOther]
      : profile.diagnoses;

  const communicationTags =
    profile.communicationMethods.includes("Other") && profile.communicationMethodsOther
      ? [
          ...profile.communicationMethods.filter((m) => m !== "Other"),
          profile.communicationMethodsOther,
        ]
      : profile.communicationMethods;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-28">
      <header className="px-4 pt-6 pb-3">
        <button
          type="button"
          onClick={() => router.push("/clinician/passports")}
          aria-label="Back"
          className="mb-2 text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </button>
        <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
          {profile.childFullName}&apos;s Clinical File
        </h1>
        {!isCalmStatusLoading && (
          <p
            className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
              isCalmButtonLive ? "bg-calm-pill text-calm-ink" : "bg-black/5 text-black/40"
            }`}
          >
            <span aria-hidden>🩹</span> Calm button {isCalmButtonLive ? "live" : "not yet live"}
          </p>
        )}
        {engagement && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-brand-neutral-black/50">
              {engagement.engagedBy === "parent"
                ? "Connected by the family"
                : `Connected by ${engagement.engagedByInstitutionName ?? "the school"}`}
            </p>
            <button
              type="button"
              onClick={() => setIsEndInvolvementOpen(true)}
              className="text-xs font-semibold text-brand-golden-brown"
            >
              End your involvement
            </button>
          </div>
        )}
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
            <SectionHeading>Profile</SectionHeading>
            {diagnosisTags.length > 0 ? (
              <PillRow items={diagnosisTags} />
            ) : (
              <EmptyCard text="No diagnosis information provided." />
            )}

            <SectionHeading>Key Communication</SectionHeading>
            {communicationTags.length > 0 ? (
              <PillRow items={communicationTags} />
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
              <PillRow items={communicationTags} />
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
            viewerRole="clinician"
            highlightLogId={searchParams.get("logId")}
          />
        )}

        {activeTab === "incidentLog" && <ClinicalFileIncidentsTab passportId={passportId} />}

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
              <ClinicalTeamSection items={clinicalContentItems} viewerRole="clinician" />
            )}
          </>
        )}

        {activeTab === "fba" && (
          <ClinicalFileFbaTab passportId={passportId} childName={profile.childFullName} />
        )}

        {activeTab === "messages" && user && (
          <ClinicalFileMessagesTab passportId={passportId} childName={profile.childFullName} userId={user.id} />
        )}

        {activeTab === "progress" && (
          <ProgressSurface passportId={passportId} childFullName={profile.childFullName} role="clinician" />
        )}

        {activeTab === "effectiveness" && <EffectivenessSurface passportId={passportId} />}
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-black/5 bg-white p-4">
        <div className="mx-auto flex w-full max-w-sm gap-2">
          <button
            type="button"
            onClick={() => setIsAbcLoggerOpen(true)}
            className="flex-1 rounded-2xl border-2 border-brand-prussian-blue py-3.5 text-sm font-semibold text-brand-prussian-blue"
          >
            + Log ABC Incident
          </button>
        </div>
      </div>

      {isAbcLoggerOpen && user && (
        <ABCLogger
          passportId={passportId}
          childName={profile.childFullName}
          role="clinician"
          onComplete={() => {
            setIsAbcLoggerOpen(false);
            setTimelineRefreshKey((key) => key + 1);
            setActiveTab("incidents");
          }}
          onDismiss={() => setIsAbcLoggerOpen(false)}
        />
      )}

      {engagement && (
        <ReasonConfirmSheet
          isOpen={isEndInvolvementOpen}
          title={`End your involvement with ${profile.childFullName}?`}
          description="You'll lose access to this passport immediately. This is your own professional decision -- please give a reason."
          confirmLabel="End Involvement"
          submittingLabel="Ending…"
          onClose={() => setIsEndInvolvementOpen(false)}
          onConfirm={async (reason) => {
            const supabase = createClient();
            const { error } = await supabase.rpc("revoke_clinician_access", {
              p_clinician_access_id: engagement.clinicianAccessId,
              p_reason: reason,
            });
            return { error: error?.message ?? null };
          }}
          onConfirmed={() => {
            setIsEndInvolvementOpen(false);
            router.push("/clinician/passports");
          }}
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

function PillRow({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full bg-brand-pastel-blue/20 px-3 py-1.5 text-xs font-semibold text-brand-prussian-blue"
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
