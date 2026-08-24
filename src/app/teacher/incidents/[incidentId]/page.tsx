"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRedirect } from "@/lib/roleRedirect";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { Textarea } from "@/components/ui/Textarea";
import { PillSingleSelect } from "@/components/ui/PillSingleSelect";
import { PillMultiSelect } from "@/components/ui/PillMultiSelect";

// School Incident Log -- Phase 3 stage two, built in sections per
// explicit instruction: category & narrative first (this round), then
// actions & restrictive practice, then injuries & body map, then
// debrief. This file grows a section at a time rather than shipping the
// whole form unreviewed.
//
// Child/staff display names resolve through get_institution_child_roster()/
// get_institution_staff_roster(), never an embedded passports(...) join
// -- see CLAUDE.md's Supabase/Postgres gotchas. incident_children's own
// columns (distress_level, remained_on_site, etc.) need no such
// workaround: that table's RLS already follows the incident via
// can_view_incident, nothing there depends on passport_access.
//
// Editable only by the incident's creator or owning teacher, pre-signoff
// -- read-only otherwise, matching the DB's own "Creator or owning
// teacher can edit before teacher sign-off" policy exactly rather than
// guessing at it client-side (this just decides whether to render
// inputs vs plain text; the policy is what actually enforces it).
//
// Tone: clinical, matching the rest of this module.

const CATEGORY_OPTIONS = [
  { value: "behaviour_leading_to_injury", label: "Behaviour leading to injury" },
  { value: "imminent_risk_of_injury", label: "Imminent risk of injury" },
  { value: "one_party_incident", label: "One-party incident" },
] as const;

const PARTY_OPTIONS = [
  { value: "self", label: "Self" },
  { value: "peer", label: "Peer" },
  { value: "staff", label: "Staff" },
] as const;

const STAFF_COUNT_OPTIONS = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5+", label: "5+" },
] as const;

const STAFF_DISTRESSED_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "slightly", label: "Slightly" },
  { value: "no", label: "No" },
] as const;

const DISTRESS_LEVEL_OPTIONS = [
  { value: "yes_definitely", label: "Yes, definitely" },
  { value: "slightly", label: "Slightly" },
  { value: "not_distressed", label: "Not distressed" },
  { value: "hard_to_tell", label: "Hard to tell" },
] as const;

const REMAINED_ON_SITE_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

type Category = (typeof CATEGORY_OPTIONS)[number]["value"];
type Party = (typeof PARTY_OPTIONS)[number]["value"];
type StaffCount = (typeof STAFF_COUNT_OPTIONS)[number]["value"];
type StaffDistressed = (typeof STAFF_DISTRESSED_OPTIONS)[number]["value"];
type DistressLevel = (typeof DISTRESS_LEVEL_OPTIONS)[number]["value"];

interface ChildFormState {
  id: string;
  passportId: string;
  childIndex: string;
  childName: string;
  distressLevel: DistressLevel | null;
  remainedOnSite: boolean | null;
  remainedDetail: string;
  recoveryMethods: string[];
}

interface StampSummary {
  occurredAt: string;
  locationValue: string;
  staffNames: string[];
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return (
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })
  );
}

export default function IncidentRecordPage() {
  const router = useRouter();
  const params = useParams<{ incidentId: string }>();
  const { user, isReady } = useRequireRole(["class_teacher", "sna", "principal"]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  const [summary, setSummary] = useState<StampSummary | null>(null);
  const [children, setChildren] = useState<ChildFormState[]>([]);
  const [recoveryOptions, setRecoveryOptions] = useState<string[]>([]);

  const [category, setCategory] = useState<Category | null>(null);
  const [party, setParty] = useState<Party | null>(null);
  const [itemInvolved, setItemInvolved] = useState("");
  const [narrative, setNarrative] = useState("");
  const [parentSummary, setParentSummary] = useState("");
  const [staffCountNeeded, setStaffCountNeeded] = useState<StaffCount | null>(null);
  const [staffDistressed, setStaffDistressed] = useState<StaffDistressed | null>(null);
  const [riskReductionFuture, setRiskReductionFuture] = useState("");
  const [otherInformation, setOtherInformation] = useState("");

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!user || !params.incidentId) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();

      const { data: incident, error: incidentError } = await supabase
        .from("incidents")
        .select(
          "institution_id, created_by, owning_teacher_id, teacher_signed_at, occurred_at, incident_locations(value), category, party, item_involved, narrative, parent_summary, staff_count_needed, staff_distressed, risk_reduction_future, other_information"
        )
        .eq("id", params.incidentId)
        .maybeSingle();

      if (!isMounted) return;

      if (incidentError || !incident) {
        setError("Could not find this incident.");
        setIsLoading(false);
        return;
      }

      const [{ data: childRows }, { data: staffRows }, { data: staffRoster }, { data: childRoster }, { data: recoveryTypes }] =
        await Promise.all([
          supabase
            .from("incident_children")
            .select("id, child_index, passport_id, distress_level, remained_on_site, remained_detail, recovery_methods")
            .eq("incident_id", params.incidentId)
            .order("child_index"),
          supabase.from("incident_staff").select("user_id, free_text_name").eq("incident_id", params.incidentId),
          supabase.rpc("get_institution_staff_roster", { p_institution_id: incident.institution_id }),
          // Roster-scoped resolution, not an embedded passports(...) join
          // -- see this file's header comment and CLAUDE.md.
          supabase.rpc("get_institution_child_roster", { p_institution_id: incident.institution_id }),
          supabase
            .from("incident_recovery_types")
            .select("value")
            .or(`institution_id.is.null,institution_id.eq.${incident.institution_id}`)
            .eq("is_active", true)
            .order("sort_order"),
        ]);

      if (!isMounted) return;

      const locationRecord = incident.incident_locations as unknown as { value: string } | { value: string }[] | null;
      const locationValue = Array.isArray(locationRecord) ? locationRecord[0]?.value : locationRecord?.value;

      const nameByUserId = new Map<string, string | null>(
        (staffRoster ?? []).map((row: { user_id: string; full_name: string | null }) => [row.user_id, row.full_name])
      );
      const nameByPassportId = new Map<string, string | null>(
        (childRoster ?? []).map((row: { passport_id: string; child_name: string | null }) => [row.passport_id, row.child_name])
      );

      setSummary({
        occurredAt: incident.occurred_at,
        locationValue: locationValue ?? "Unknown location",
        staffNames: (staffRows ?? []).map(
          (row) => row.free_text_name || nameByUserId.get(row.user_id ?? "") || "Named staff member"
        ),
      });

      setChildren(
        (childRows ?? []).map((row) => ({
          id: row.id,
          passportId: row.passport_id,
          childIndex: row.child_index,
          childName: nameByPassportId.get(row.passport_id) || "Unnamed child",
          distressLevel: row.distress_level as DistressLevel | null,
          remainedOnSite: row.remained_on_site,
          remainedDetail: row.remained_detail ?? "",
          recoveryMethods: row.recovery_methods ?? [],
        }))
      );

      setRecoveryOptions((recoveryTypes ?? []).map((row) => row.value));

      setCategory(incident.category as Category | null);
      setParty(incident.party as Party | null);
      setItemInvolved(incident.item_involved ?? "");
      setNarrative(incident.narrative ?? "");
      setParentSummary(incident.parent_summary ?? "");
      setStaffCountNeeded(incident.staff_count_needed as StaffCount | null);
      setStaffDistressed(incident.staff_distressed as StaffDistressed | null);
      setRiskReductionFuture(incident.risk_reduction_future ?? "");
      setOtherInformation(incident.other_information ?? "");

      setIsLocked(Boolean(incident.teacher_signed_at));
      setCanEdit(
        !incident.teacher_signed_at && (incident.created_by === user!.id || incident.owning_teacher_id === user!.id)
      );

      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user, params.incidentId]);

  if (!isReady) {
    return null;
  }

  function updateChild(childId: string, patch: Partial<ChildFormState>) {
    setChildren((current) => current.map((c) => (c.id === childId ? { ...c, ...patch } : c)));
  }

  function toggleRecoveryMethod(childId: string, methodValue: string) {
    setChildren((current) =>
      current.map((c) => {
        if (c.id !== childId) return c;
        const has = c.recoveryMethods.includes(methodValue);
        return { ...c, recoveryMethods: has ? c.recoveryMethods.filter((m) => m !== methodValue) : [...c.recoveryMethods, methodValue] };
      })
    );
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveError(null);

    const supabase = createClient();

    const { error: incidentUpdateError } = await supabase
      .from("incidents")
      .update({
        category,
        party,
        item_involved: itemInvolved.trim() || null,
        narrative: narrative.trim() || null,
        parent_summary: parentSummary.trim() || null,
        staff_count_needed: staffCountNeeded,
        staff_distressed: staffDistressed,
        risk_reduction_future: riskReductionFuture.trim() || null,
        other_information: otherInformation.trim() || null,
      })
      .eq("id", params.incidentId);

    if (incidentUpdateError) {
      setIsSaving(false);
      setSaveError(incidentUpdateError.message);
      return;
    }

    for (const child of children) {
      const { error: childUpdateError } = await supabase
        .from("incident_children")
        .update({
          distress_level: child.distressLevel,
          remained_on_site: child.remainedOnSite,
          remained_detail: child.remainedDetail.trim() || null,
          recovery_methods: child.recoveryMethods.length > 0 ? child.recoveryMethods : null,
        })
        .eq("id", child.id);

      if (childUpdateError) {
        setIsSaving(false);
        setSaveError(childUpdateError.message);
        return;
      }
    }

    setIsSaving(false);
    setSavedAt(Date.now());
  }

  const staffRole = user?.app_metadata?.role as string | undefined;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-10">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <button
          type="button"
          onClick={() => router.push(getPostAuthRedirect(staffRole))}
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </button>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Incident Record</h1>
      </header>

      <main className="flex-1 px-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-32 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : error ? (
          <p className="text-sm text-brand-neutral-black/60">{error}</p>
        ) : summary ? (
          <div className="flex flex-col gap-6">
            <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-brand-neutral-black">{formatDateTime(summary.occurredAt)}</p>
              <p className="mt-0.5 text-sm text-brand-neutral-black/70">{summary.locationValue}</p>

              <div className="mt-3 border-t border-black/5 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">Child</p>
                <p className="mt-1 text-sm text-brand-neutral-black">
                  {children.map((c) => c.childName).join(", ")}
                </p>
              </div>

              {summary.staffNames.length > 0 && (
                <div className="mt-3 border-t border-black/5 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">
                    Staff present
                  </p>
                  <p className="mt-1 text-sm text-brand-neutral-black">{summary.staffNames.join(", ")}</p>
                </div>
              )}
            </div>

            {isLocked && (
              <p className="rounded-2xl border border-brand-golden-brown/30 bg-brand-golden-brown/10 p-4 text-sm text-brand-neutral-black">
                This incident is teacher-signed and immutable. Corrections go through an amendment, not this form.
              </p>
            )}

            {!canEdit && !isLocked && (
              <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                Only the incident&apos;s creator or owning teacher can complete this record. You can view the stamp
                above but not edit the record below.
              </p>
            )}

            <fieldset disabled={!canEdit} className="flex flex-col gap-6 disabled:opacity-60">
              <section>
                <h2 className="mb-3 font-heading text-lg font-bold text-brand-prussian-blue">Category &amp; Narrative</h2>

                <div className="flex flex-col gap-5 rounded-2xl border border-black/5 bg-white p-4">
                  <div>
                    <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Category</span>
                    <PillSingleSelect options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />
                  </div>

                  <div>
                    <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Party</span>
                    <PillSingleSelect options={PARTY_OPTIONS} value={party} onChange={setParty} />
                  </div>

                  <TextField
                    label="Item involved"
                    id="item-involved"
                    value={itemInvolved}
                    onChange={(e) => setItemInvolved(e.target.value)}
                    placeholder="Optional"
                  />

                  <Textarea
                    label="Narrative (staff-facing account)"
                    id="narrative"
                    value={narrative}
                    onChange={(e) => setNarrative(e.target.value)}
                    rows={5}
                  />

                  <Textarea
                    label="Parent summary"
                    id="parent-summary"
                    value={parentSummary}
                    onChange={(e) => setParentSummary(e.target.value)}
                    rows={3}
                  />

                  <div>
                    <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">
                      Staff needed to manage this
                    </span>
                    <PillSingleSelect options={STAFF_COUNT_OPTIONS} value={staffCountNeeded} onChange={setStaffCountNeeded} />
                  </div>

                  <div>
                    <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Staff distressed</span>
                    <PillSingleSelect
                      options={STAFF_DISTRESSED_OPTIONS}
                      value={staffDistressed}
                      onChange={setStaffDistressed}
                    />
                  </div>

                  <Textarea
                    label="Risk reduction for the future"
                    id="risk-reduction-future"
                    value={riskReductionFuture}
                    onChange={(e) => setRiskReductionFuture(e.target.value)}
                    rows={3}
                  />

                  <Textarea
                    label="Other information"
                    id="other-information"
                    value={otherInformation}
                    onChange={(e) => setOtherInformation(e.target.value)}
                    rows={3}
                  />
                </div>
              </section>

              {children.map((child) => (
                <section key={child.id}>
                  <h2 className="mb-3 font-heading text-lg font-bold text-brand-prussian-blue">
                    {child.childName} -- Impact
                  </h2>

                  <div className="flex flex-col gap-5 rounded-2xl border border-black/5 bg-white p-4">
                    <div>
                      <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Distress level</span>
                      <PillSingleSelect
                        options={DISTRESS_LEVEL_OPTIONS}
                        value={child.distressLevel}
                        onChange={(v) => updateChild(child.id, { distressLevel: v })}
                      />
                    </div>

                    <div>
                      <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Remained on site</span>
                      <PillSingleSelect
                        options={REMAINED_ON_SITE_OPTIONS}
                        value={child.remainedOnSite === null ? null : child.remainedOnSite ? "yes" : "no"}
                        onChange={(v) => updateChild(child.id, { remainedOnSite: v === "yes" })}
                      />
                    </div>

                    <TextField
                      label="Remained-on-site detail"
                      id={`remained-detail-${child.id}`}
                      value={child.remainedDetail}
                      onChange={(e) => updateChild(child.id, { remainedDetail: e.target.value })}
                      placeholder="Optional"
                    />

                    <div>
                      <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">
                        Recovery methods
                      </span>
                      <PillMultiSelect
                        options={recoveryOptions.map((v) => ({ value: v }))}
                        selected={child.recoveryMethods}
                        onToggle={(v) => toggleRecoveryMethod(child.id, v)}
                      />
                    </div>
                  </div>
                </section>
              ))}
            </fieldset>

            {canEdit && (
              <>
                {saveError && (
                  <p role="alert" className="text-sm font-medium text-red-600">
                    {saveError}
                  </p>
                )}
                {savedAt && !saveError && (
                  <p className="text-sm font-medium text-green-700">Saved.</p>
                )}
                <Button type="button" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? "Saving…" : "Save"}
                </Button>
              </>
            )}

            <p className="text-sm leading-relaxed text-brand-neutral-black/60">
              Actions taken, restrictive practice, injuries, and debrief are not yet available in this build. This
              record is saved and will not be lost.
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
