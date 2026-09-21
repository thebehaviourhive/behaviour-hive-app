"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { EpisodeTagsSection } from "@/components/clinic/EpisodeTagsSection";
import { DischargeEpisodeSheet } from "@/components/principal/DischargeEpisodeSheet";
import { ReassignCaseloadSheet } from "@/components/clinic/ReassignCaseloadSheet";
import {
  ProfileBlock,
  CommunicationBlock,
  BehaviourSignalsBlock,
  SupportsBlock,
  withOtherTag,
} from "@/components/passport/ClassroomProfileContent";

// PRD 10 Stage 5, item 3 -- the scope-only client view. Built for the
// case /clinician/passport/[id] (ClinicalFileDetail) can't serve: a
// client within a lead's SCOPE but not on their own CASELOAD, so
// clinician_access grants them nothing and is_verified_clinician's own
// gate never admits them there. get_child_passport_profile_for_lead()
// (0216) is the data layer this was always meant to feed -- built,
// proven, zero client callers until now.
//
// Reuses ClassroomProfileContent.tsx's own shared presentational
// blocks (the teacher/ChildDetail precedent, whose own header already
// invites this: "these blocks don't need to care which" fetch feeds
// them) rather than a third hand-rolled rendering of the same fields.
//
// THE SESSION NOTES STATEMENT lives here, explicit, always rendered --
// never a silently-absent section. This is the one screen a lead with
// real oversight of a child would otherwise see no notes on and
// reasonably conclude there are none (session_notes' own RLS has no
// clinical_lead branch at all, CLAUDE.md's own carried-forward
// instruction on this point, confirmed still true in Stage 5 recon).
//
// EpisodeTagsSection is mounted here too -- Stage 3 left leads out of
// "raise a request" reasoning "because they had no screen"; that
// premise was already overtaken for CASELOAD clients once 0266 widened
// useRequireRole("clinician"), and this closes the other half: a scope
// client, not a caseload one, now has somewhere for that component to
// live too.
export default function ClinicalLeadClientPage() {
  const { isReady } = useRequireRole("clinical_lead");
  const params = useParams();
  const passportId = params.passportId as string;

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<PassportProfile | null>(null);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [clinicians, setClinicians] = useState<ClinicianRow[]>([]);

  const [reassignTarget, setReassignTarget] = useState<ClinicianRow | null>(null);
  const [isDischargeOpen, setIsDischargeOpen] = useState(false);

  const load = useCallback(async () => {
    if (!isReady || !passportId) return;
    setIsLoading(true);
    setError(null);
    const supabase = createClient();

    const { data: staffRow } = await supabase
      .from("institution_staff")
      .select("institution_id")
      .eq("role", "clinical_lead")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (!staffRow) {
      setError("Could not find your clinic.");
      setIsLoading(false);
      return;
    }
    setInstitutionId(staffRow.institution_id);

    const [profileResult, episodeResult, cliniciansResult] = await Promise.all([
      supabase.rpc("get_child_passport_profile_for_lead", { p_passport_id: passportId }).maybeSingle(),
      supabase
        .from("episodes_of_care")
        .select("id")
        .eq("institution_id", staffRow.institution_id)
        .eq("passport_id", passportId)
        .is("ended_at", null)
        .maybeSingle(),
      supabase.rpc("get_passport_clinicians", { p_passport_id: passportId }),
    ]);

    if (!profileResult.data) {
      setError("This client isn't within your scope, or doesn't exist.");
      setIsLoading(false);
      return;
    }
    setProfile(profileResult.data as PassportProfile);
    setEpisodeId(episodeResult.data?.id ?? null);
    setClinicians(((cliniciansResult.data ?? []) as ClinicianRowRaw[]).map(mapClinicianRow));

    setIsLoading(false);
  }, [isReady, passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!isReady || isLoading) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/clinical-lead/dashboard"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="flex-1 font-heading text-xl font-bold text-brand-prussian-blue">
          {profile?.child_name ?? "Client"}
        </h1>
      </header>

      <main className="flex-1 px-4 lg:max-w-[66.6667%]">
        {error ? (
          <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
            {error}
          </p>
        ) : (
          <>
            <section className="mb-8 rounded-2xl border border-brand-golden-brown/30 bg-brand-golden-brown/10 p-4">
              <p className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-golden-brown">
                Session Notes
              </p>
              <p className="mt-1 text-sm text-brand-neutral-black">
                As a clinical lead, you cannot see this client&apos;s session notes. They&apos;re visible only to the
                practitioner who wrote them and to your clinic&apos;s own director.
              </p>
            </section>

            {profile && (
              <div className="flex flex-col gap-6">
                <ProfileBlock diagnosisTags={withOtherTag(profile.diagnoses ?? [], profile.diagnosis_other)} />
                <BehaviourSignalsBlock
                  hardSignals={profile.hard_signals ?? []}
                  hardSignalsOther={profile.hard_signals_other}
                  hardTriggers={profile.hard_triggers ?? []}
                  hardTriggersOther={profile.hard_triggers_other}
                />
                <CommunicationBlock
                  communicationTags={withOtherTag(profile.communication_methods ?? [], profile.communication_methods_other)}
                  showsHappy={profile.shows_happy}
                  showsAnxious={profile.shows_anxious}
                  phrasesToAvoid={profile.phrases_to_avoid}
                />
                <SupportsBlock
                  beforeBehaviour={profile.before_behaviour ?? []}
                  beforeBehaviourOther={profile.before_behaviour_other}
                  duringDistress={profile.during_distress ?? []}
                  duringDistressOther={profile.during_distress_other}
                  afterDistress={profile.after_distress ?? []}
                  afterDistressOther={profile.after_distress_other}
                  sensorySeeks={profile.sensory_seeks ?? []}
                  sensorySeeksOther={profile.sensory_seeks_other}
                  sensoryAvoids={profile.sensory_avoids ?? []}
                  sensoryAvoidsOther={profile.sensory_avoids_other}
                />
              </div>
            )}

            <section className="mt-8">
              <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
                Clinical Team
              </h2>
              {clinicians.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                  No practitioner currently holds this client&apos;s caseload.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {clinicians.map((c) => (
                    <div key={c.clinicianAccessId} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                      <p className="font-sans text-body font-semibold text-brand-neutral-black">{c.fullName}</p>
                      <p className="mt-0.5 text-xs text-brand-neutral-black/60">{c.specialty}</p>
                      {c.engagedBy === "institution" && c.engagedByInstitutionId === institutionId && (
                        <button
                          type="button"
                          onClick={() => setReassignTarget(c)}
                          className="mt-2 font-sans text-sm font-semibold text-brand-prussian-blue"
                        >
                          Reassign
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {institutionId && <EpisodeTagsSection passportId={passportId} />}

            {episodeId && (
              <section className="mt-8">
                <button
                  type="button"
                  onClick={() => setIsDischargeOpen(true)}
                  className="block w-full rounded-2xl border border-brand-golden-brown px-6 py-3 text-center font-sans text-body font-semibold text-brand-golden-brown lg:w-auto"
                >
                  Discharge
                </button>
              </section>
            )}
          </>
        )}
      </main>

      {reassignTarget && institutionId && (
        <ReassignCaseloadSheet
          isOpen={!!reassignTarget}
          clinicianAccessId={reassignTarget.clinicianAccessId}
          institutionId={institutionId}
          childName={profile?.child_name ?? "this client"}
          currentClinicianName={reassignTarget.fullName}
          onClose={() => setReassignTarget(null)}
          onReassigned={() => {
            setReassignTarget(null);
            load();
          }}
        />
      )}

      {episodeId && institutionId && (
        <DischargeEpisodeSheet
          isOpen={isDischargeOpen}
          episodeId={episodeId}
          institutionId={institutionId}
          childName={profile?.child_name ?? "this client"}
          onClose={() => setIsDischargeOpen(false)}
          onDischarged={() => {
            setIsDischargeOpen(false);
          }}
        />
      )}
    </div>
  );
}

interface PassportProfile {
  child_name: string;
  diagnoses: string[] | null;
  diagnosis_other: string | null;
  section_a_complete: boolean;
  hard_signals: string[] | null;
  hard_signals_other: string | null;
  hard_triggers: string[] | null;
  hard_triggers_other: string | null;
  communication_methods: string[] | null;
  communication_methods_other: string | null;
  shows_happy: string | null;
  shows_anxious: string | null;
  phrases_to_avoid: string | null;
  before_behaviour: string[] | null;
  before_behaviour_other: string | null;
  during_distress: string[] | null;
  during_distress_other: string | null;
  after_distress: string[] | null;
  after_distress_other: string | null;
  sensory_seeks: string[] | null;
  sensory_seeks_other: string | null;
  sensory_avoids: string[] | null;
  sensory_avoids_other: string | null;
}

interface ClinicianRowRaw {
  clinician_access_id: string;
  clinician_id: string;
  full_name: string;
  specialty: string;
  last_review_date: string;
  linked_at: string;
  engaged_by: string;
  engaged_by_institution_id: string | null;
  engaged_by_institution_name: string | null;
}

interface ClinicianRow {
  clinicianAccessId: string;
  clinicianId: string;
  fullName: string;
  specialty: string;
  engagedBy: string;
  engagedByInstitutionId: string | null;
}

function mapClinicianRow(r: ClinicianRowRaw): ClinicianRow {
  return {
    clinicianAccessId: r.clinician_access_id,
    clinicianId: r.clinician_id,
    fullName: r.full_name ?? "This practitioner",
    specialty: r.specialty,
    engagedBy: r.engaged_by,
    engagedByInstitutionId: r.engaged_by_institution_id,
  };
}
