"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRedirect } from "@/lib/roleRedirect";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { Textarea } from "@/components/ui/Textarea";
import { PillSingleSelect } from "@/components/ui/PillSingleSelect";
import { PillMultiSelect } from "@/components/ui/PillMultiSelect";
import { BodyMapCard, type InjuryTypeOption, type RegionOption } from "@/components/incident-log/body-map/BodyMapCard";
import { SignOffCard } from "@/components/incident-log/SignOffCard";
import { AttestationCard } from "@/components/incident-log/AttestationCard";
import { RequestAttestationsCard } from "@/components/incident-log/RequestAttestationsCard";
import { CountersignCard } from "@/components/incident-log/CountersignCard";
import { friendlyAccessLapsedMessage } from "@/lib/temporaryAccessTime";

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
  { value: "self", label: "self" },
  { value: "peer", label: "peer" },
  { value: "staff", label: "staff" },
  { value: "other", label: "Other" },
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
  { value: "slightly", label: "Slightly distressing" },
  { value: "no", label: "No" },
] as const;

const DISTRESS_LEVEL_OPTIONS = [
  { value: "yes_definitely", label: "Yes, definitely" },
  { value: "slightly", label: "Slightly distressed" },
  { value: "not_distressed", label: "Not distressed" },
  { value: "hard_to_tell", label: "hard to tell" },
] as const;

const REMAINED_ON_SITE_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

// Required, no default -- an active choice every time, never an
// accepted default. The one field in this module not on the paper form
// -- added because it's the distinction any reviewer, investigation, or
// NCSE return cares about most: was this technique already set out in
// the child's behaviour support plan, or an unplanned emergency
// response.
const PLANNING_STATUS_OPTIONS = [
  { value: "in_bsp", label: "In BSP" },
  { value: "not_planned", label: "Not planned" },
] as const;

const HOLD_TYPE_OPTIONS = [
  { value: "childrens", label: "Children's" },
  { value: "young_person", label: "Young person's" },
] as const;

const HOLD_POSITION_OPTIONS = [
  { value: "seated", label: "Seated" },
  { value: "standing", label: "Standing" },
] as const;

const HOLD_LEVEL_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "med", label: "Medium" },
  { value: "high", label: "High" },
] as const;

type Category = (typeof CATEGORY_OPTIONS)[number]["value"];
type Party = (typeof PARTY_OPTIONS)[number]["value"];
type StaffCount = (typeof STAFF_COUNT_OPTIONS)[number]["value"];
type StaffDistressed = (typeof STAFF_DISTRESSED_OPTIONS)[number]["value"];
type DistressLevel = (typeof DISTRESS_LEVEL_OPTIONS)[number]["value"];
type PlanningStatus = (typeof PLANNING_STATUS_OPTIONS)[number]["value"];
type HoldType = (typeof HOLD_TYPE_OPTIONS)[number]["value"];
type HoldPosition = (typeof HOLD_POSITION_OPTIONS)[number]["value"];
type HoldLevel = (typeof HOLD_LEVEL_OPTIONS)[number]["value"];

interface ChildFormState {
  id: string;
  passportId: string;
  childIndex: string;
  childName: string;
  distressLevel: DistressLevel | null;
  remainedOnSite: boolean | null;
  remainedDetail: string;
  recoveryMethods: string[];
  recoveryMethodsOther: string;
  parentCallRequired: boolean;
  parentCalledAt: string | null;
  parentCalledBy: string | null;
  parentNotifiedAt: string | null;
  parentNotificationBlockedReason: string | null;
  // Migration 0152 -- a parent's own record of having seen this, once
  // signed off. Distinct fact from the two above (we sent it / we
  // called them), never implying either when absent.
  parentAcknowledgedAt: string | null;
}

interface StampSummary {
  occurredAt: string;
  locationValue: string;
  staffNames: string[];
}

interface ActionType {
  id: string;
  value: string;
  isRestraint: boolean;
}

interface RestrictivePracticeRecord {
  id: string | null; // null = not yet saved -- only these can be removed client-side.
  planningStatus: PlanningStatus | null;
  reasonCodes: string[];
  disengagementCodes: string[];
  holdType: HoldType | null;
  holdPosition: HoldPosition | null;
  holdLevel: HoldLevel | null;
  resultCodes: string[];
  totalProcedures: string;
  staffInitials: string; // legacy, read-only -- see the CPI section's own comment.
  linkedStaffIds: string[]; // incident_staff.id values -- real accounts only.
  ncseReportComplete: boolean | null; // null = not answered, distinct from an answered No (0081).
  isSaving: boolean;
  saveError: string | null;
  savedAt: number | null;
}

function blankRestrictivePracticeRecord(): RestrictivePracticeRecord {
  return {
    id: null,
    planningStatus: null,
    reasonCodes: [],
    disengagementCodes: [],
    holdType: null,
    holdPosition: null,
    holdLevel: null,
    resultCodes: [],
    totalProcedures: "",
    staffInitials: "",
    linkedStaffIds: [],
    ncseReportComplete: null,
    isSaving: false,
    saveError: null,
    savedAt: null,
  };
}

interface InjuryRecordState {
  id: string;
  injuredPartyType: "student" | "staff";
  passportId: string | null;
  staffUserId: string | null;
  partyName: string;
  injuryTypes: string[];
  injuryNotes: string;
  firstAiderCalled: boolean | null;
  firstAiderName: string;
  doctorAmbulanceCalled: boolean | null;
  treatments: string[];
  treatmentOther: string;
  remainedOnSite: boolean | null;
  remainedDetail: string;
}

const TREATMENT_OPTIONS = ["Head injury assessment", "ice pack", "disinfected", "wound covered", "Other"];

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
  // Bug report item 2 -- SignOffCard's own onSignedOff used to call
  // window.location.reload(), a genuine full browser navigation. This
  // codebase already has one documented case (CLAUDE.md, "verification
  // environment") of Next.js's client Router Cache serving a stale
  // payload for the SAME route across a hard reload in the SAME tab --
  // sign-off changes what this exact URL renders (locked vs unlocked,
  // several conditionally-rendered sections), so a stale/mismatched
  // payload landing here is a real, precedented risk, not a hypothetical
  // one, and matches every symptom reported (blank screen reading as a
  // crash, resolves on a subsequent interaction). Bumping this key
  // re-runs the load effect below in place -- a real refetch of
  // everything derived from teacher_signed_at, with no navigation, no
  // unmount, and nothing for a stale cached payload to ever serve.
  const [reloadKey, setReloadKey] = useState(0);

  const [summary, setSummary] = useState<StampSummary | null>(null);
  const [children, setChildren] = useState<ChildFormState[]>([]);
  const [recoveryOptions, setRecoveryOptions] = useState<string[]>([]);

  const [actionTypes, setActionTypes] = useState<ActionType[]>([]);
  const [selectedActionTypeIds, setSelectedActionTypeIds] = useState<string[]>([]);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const [otherActionDetail, setOtherActionDetail] = useState("");
  const [cpiReasonOptions, setCpiReasonOptions] = useState<string[]>([]);
  const [cpiDisengagementOptions, setCpiDisengagementOptions] = useState<string[]>([]);
  const [cpiResultOptions, setCpiResultOptions] = useState<string[]>([]);
  // Keyed by passport_id -- a restrictive-practice record belongs to one
  // named child, not the incident as a whole (0068 Part 7).
  const [restrictivePracticesByChild, setRestrictivePracticesByChild] = useState<Record<string, RestrictivePracticeRecord[]>>({});
  // Real-account staff named on this incident at the stamp -- the only
  // people who can be linked to a restrictive practice record (0080's
  // trigger rejects free-text-only entries; no fallback here, per the brief).
  const [incidentStaffOptions, setIncidentStaffOptions] = useState<{ id: string; name: string }[]>([]);

  const [injuryTypeOptions, setInjuryTypeOptions] = useState<InjuryTypeOption[]>([]);
  const [regionOptions, setRegionOptions] = useState<RegionOption[]>([]);
  const [injuries, setInjuries] = useState<InjuryRecordState[]>([]);
  const [isAddingInjury, setIsAddingInjury] = useState(false);
  // The injured party is picked from people already named on the
  // incident -- children or staff, account or not -- never typed fresh.
  // Free text is a genuine fallback, only for someone who was never
  // named at the stamp at all.
  const [newInjuryParty, setNewInjuryParty] = useState<
    | { kind: "student"; passportId: string; name: string }
    | { kind: "named_staff"; userId: string | null; freeTextName: string | null; name: string }
    | null
  >(null);
  const [newInjuryStaffFreeText, setNewInjuryStaffFreeText] = useState("");
  const [addInjuryError, setAddInjuryError] = useState<string | null>(null);

  // "Was a student or staff member injured?" -- the form's own gate,
  // one answer for the whole incident. Immediate-write, not batched --
  // debrief_required taught this module that a gate like this silently
  // failing to persist (never touching the top-level Save) is a real,
  // hard-to-notice bug, not a hypothetical one.
  const [anyoneInjured, setAnyoneInjured] = useState<boolean | null>(null);
  const [anyoneInjuredSaveError, setAnyoneInjuredSaveError] = useState<string | null>(null);
  // Migration 0153 -- "Was the Support Button pressed?" A plain
  // boolean on the incident itself. Migration 0156 added an optional
  // support_alert_id alongside it -- item 7 needs to know WHICH alert
  // an incident is about (a boolean can't disambiguate once two alerts
  // are open at once, not hypothetical on a bad afternoon), so this is
  // no longer "not a structured cross-reference" -- it can be one, when
  // a matching alert exists to link.
  const [supportButtonPressed, setSupportButtonPressed] = useState<boolean>(false);
  const [supportButtonSaveError, setSupportButtonSaveError] = useState<string | null>(null);
  const [supportAlertId, setSupportAlertId] = useState<string | null>(null);
  const [supportAlertSaveError, setSupportAlertSaveError] = useState<string | null>(null);
  const [candidateSupportAlerts, setCandidateSupportAlerts] = useState<
    { id: string; room_names: string[]; raised_at: string }[] | null
  >(null);
  const [isLoadingCandidateAlerts, setIsLoadingCandidateAlerts] = useState(false);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [parentCallSaveError, setParentCallSaveError] = useState<string | null>(null);
  const [markingCalledChildId, setMarkingCalledChildId] = useState<string | null>(null);
  // Institution staff roster name lookup -- built once during load
  // (get_institution_staff_roster(), the same roster-scoped source
  // used for staff-name resolution elsewhere on this page), kept in
  // state so it's usable in render for parent_called_by/similar --
  // covers the owning teacher/principal even when they aren't
  // themselves named incident_staff.
  const [staffNameById, setStaffNameById] = useState<Map<string, string | null>>(new Map());
  // Every person named on the incident at the stamp -- children handled
  // separately via `children`; this is staff, account or not, for the
  // injured-party picker (a looser rule than the CPI staff picker,
  // which requires a real account -- here, anyone actually named
  // qualifies, per the brief).
  const [incidentStaffForPicker, setIncidentStaffForPicker] = useState<
    { key: string; name: string; userId: string | null; freeTextName: string | null }[]
  >([]);

  const [owningTeacherId, setOwningTeacherId] = useState<string | null>(null);
  const [owningTeacherName, setOwningTeacherName] = useState<string | null>(null);
  const [attestationsRequested, setAttestationsRequested] = useState(false);
  const [canEditDebrief, setCanEditDebrief] = useState(false);
  const [debriefRequired, setDebriefRequired] = useState(false);
  const [debriefId, setDebriefId] = useState<string | null>(null);
  const [debriefDate, setDebriefDate] = useState("");
  const [debriefStaffPresent, setDebriefStaffPresent] = useState<string[]>([]);
  const [debriefStaffInput, setDebriefStaffInput] = useState("");
  const [debriefNotes, setDebriefNotes] = useState("");
  const [debriefActionsForManagement, setDebriefActionsForManagement] = useState("");
  const [debriefCompletedAt, setDebriefCompletedAt] = useState<string | null>(null);
  const [debriefCompletedByName, setDebriefCompletedByName] = useState<string | null>(null);
  const [isSavingDebrief, setIsSavingDebrief] = useState(false);
  const [debriefSaveError, setDebriefSaveError] = useState<string | null>(null);
  const [debriefSavedAt, setDebriefSavedAt] = useState<number | null>(null);
  const [isCompletingDebrief, setIsCompletingDebrief] = useState(false);

  const [category, setCategory] = useState<Category | null>(null);
  const [party, setParty] = useState<Party[]>([]);
  const [partyOther, setPartyOther] = useState("");
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
          "institution_id, created_by, owning_teacher_id, teacher_signed_at, occurred_at, incident_locations(value), category, party, party_other, item_involved, narrative, parent_summary, staff_count_needed, staff_distressed, risk_reduction_future, other_information, debrief_required, anyone_injured, attestations_requested, support_button_pressed, support_alert_id"
        )
        .eq("id", params.incidentId)
        .maybeSingle();

      if (!isMounted) return;

      if (incidentError || !incident) {
        setError("Could not find this incident.");
        setIsLoading(false);
        return;
      }

      // PRD 1, Stage 3: the second of the two read paths Daniel named
      // explicitly ("the principal's incident queue and incident detail
      // page both calling resolve_lapsed_incident_ownership() -- both,
      // not one"). Called unconditionally for whoever can reach this
      // page, not gated to principals client-side -- 0107's own
      // authorization fix already scopes this correctly server-side to
      // any active institution staff, so duplicating that check here
      // would just be a second copy of the same logic to keep in sync.
      // Best-effort: never blocks the rest of this load.
      try {
        await supabase.rpc("resolve_lapsed_incident_ownership", { p_institution_id: incident.institution_id });
      } catch {
        // best-effort; see comment above
      }

      const institutionOrGlobal = `institution_id.is.null,institution_id.eq.${incident.institution_id}`;

      const [
        { data: childRows },
        { data: staffRows },
        { data: staffRoster },
        { data: childRoster },
        { data: recoveryTypes },
        { data: actionTypeRows },
        { data: selectedActionRows },
        { data: reasonTypes },
        { data: disengagementTypes },
        { data: resultTypes },
        { data: restrictivePracticeRows },
        { data: injuryTypeRows },
        { data: regionRows },
        { data: injuryRows },
        { data: debriefRow },
      ] = await Promise.all([
        supabase
          .from("incident_children")
          .select(
            "id, child_index, passport_id, distress_level, remained_on_site, remained_detail, recovery_methods, recovery_methods_other, parent_call_required, parent_called_at, parent_called_by, parent_notified_at, parent_notification_blocked_reason, parent_acknowledged_at"
          )
          .eq("incident_id", params.incidentId)
          .order("child_index"),
        supabase.from("incident_staff").select("id, user_id, free_text_name").eq("incident_id", params.incidentId),
        // p_include_inactive/p_include_pending: true -- this page's own
        // name resolution is for people ALREADY referenced on the
        // incident (owning_teacher_id, signers, parent_called_by), not
        // a picker of who's currently eligible. Without these, a
        // departed staff member's name silently degraded to a generic
        // fallback ("a staff member") on an already-signed record --
        // found live, the day after 0120 fixed this same RPC's caller-
        // standing check and the sweep that produced it turned attention
        // to what actually consumes the roster shape. staffNameById
        // below is only ever read for display, never to populate an
        // add-new picker (confirmed by reading every use on this page),
        // so there's no risk of offering a departed person as a new
        // pick by including them here.
        supabase.rpc("get_institution_staff_roster", {
          p_institution_id: incident.institution_id,
          p_include_inactive: true,
          p_include_pending: true,
        }),
        // Roster-scoped resolution, not an embedded passports(...) join
        // -- see this file's header comment and CLAUDE.md.
        //
        // NOTE, not fixed here: get_institution_child_roster() has no
        // p_include_inactive equivalent -- a child whose institution
        // link has ended isn't a trackable state yet (that's Stage 6's
        // own enrolments work). So a departed CHILD's name on an old
        // incident has the identical degradation this migration just
        // fixed for staff, and nothing here can close it until Stage 6
        // gives this RPC the same shape. Named, not solved.
        supabase.rpc("get_institution_child_roster", { p_institution_id: incident.institution_id }),
        supabase.from("incident_recovery_types").select("value").or(institutionOrGlobal).eq("is_active", true).order("sort_order"),
        supabase
          .from("incident_action_types")
          .select("id, value, is_restraint")
          .or(institutionOrGlobal)
          .eq("is_active", true)
          .order("sort_order"),
        supabase.from("incident_actions").select("action_type_id, other_detail").eq("incident_id", params.incidentId),
        supabase.from("cpi_reason_types").select("value").or(institutionOrGlobal).eq("is_active", true).order("sort_order"),
        supabase.from("cpi_disengagement_types").select("value").or(institutionOrGlobal).eq("is_active", true).order("sort_order"),
        supabase.from("cpi_result_types").select("value").or(institutionOrGlobal).eq("is_active", true).order("sort_order"),
        supabase
          .from("restrictive_practices")
          .select(
            "id, passport_id, planning_status, reason_codes, disengagement_codes, hold_type, hold_position, hold_level, result_codes, total_procedures, staff_initials, ncse_report_complete"
          )
          .eq("incident_id", params.incidentId),
        supabase.from("incident_injury_types").select("id, value").or(institutionOrGlobal).eq("is_active", true).order("sort_order"),
        supabase.from("incident_body_regions").select("id, value").or(institutionOrGlobal).eq("is_active", true).order("sort_order"),
        supabase
          .from("incident_injuries")
          .select(
            "id, injured_party_type, passport_id, staff_user_id, free_text_name, injury_types, injury_notes, first_aider_called, first_aider_name, doctor_ambulance_called, treatments, treatment_other, remained_on_site, remained_detail"
          )
          .eq("incident_id", params.incidentId),
        supabase
          .from("incident_debriefs")
          .select("id, debrief_date, staff_present, notes, actions_for_management, completed_by, completed_at")
          .eq("incident_id", params.incidentId)
          .maybeSingle(),
      ]);

      if (!isMounted) return;

      const locationRecord = incident.incident_locations as unknown as { value: string } | { value: string }[] | null;
      const locationValue = Array.isArray(locationRecord) ? locationRecord[0]?.value : locationRecord?.value;

      const nameByUserId = new Map<string, string | null>(
        (staffRoster ?? []).map((row: { user_id: string; full_name: string | null }) => [row.user_id, row.full_name])
      );
      setStaffNameById(nameByUserId);
      const nameByPassportId = new Map<string, string | null>(
        (childRoster ?? []).map((row: { passport_id: string; child_name: string | null }) => [row.passport_id, row.child_name])
      );

      setIncidentStaffOptions(
        (staffRows ?? [])
          .filter((row) => row.user_id)
          .map((row) => ({ id: row.id, name: nameByUserId.get(row.user_id ?? "") || "Named staff member" }))
      );
      setIncidentStaffForPicker(
        (staffRows ?? []).map((row) => ({
          key: row.id,
          name: row.free_text_name || nameByUserId.get(row.user_id ?? "") || "Named staff member",
          userId: row.user_id,
          freeTextName: row.free_text_name,
        }))
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
          recoveryMethodsOther: row.recovery_methods_other ?? "",
          parentCallRequired: row.parent_call_required,
          parentCalledAt: row.parent_called_at,
          parentCalledBy: row.parent_called_by,
          parentNotifiedAt: row.parent_notified_at,
          parentNotificationBlockedReason: row.parent_notification_blocked_reason,
          parentAcknowledgedAt: row.parent_acknowledged_at,
        }))
      );

      setRecoveryOptions((recoveryTypes ?? []).map((row) => row.value));

      setActionTypes(
        (actionTypeRows ?? []).map((row) => ({ id: row.id, value: row.value, isRestraint: row.is_restraint }))
      );
      setSelectedActionTypeIds((selectedActionRows ?? []).map((row) => row.action_type_id));
      setOtherActionDetail((selectedActionRows ?? []).find((row) => row.other_detail)?.other_detail ?? "");
      setCpiReasonOptions((reasonTypes ?? []).map((row) => row.value));
      setCpiDisengagementOptions((disengagementTypes ?? []).map((row) => row.value));
      setCpiResultOptions((resultTypes ?? []).map((row) => row.value));

      // A record's own id isn't known until the batch above resolves, so
      // the staff links are a separate follow-up query, not part of the
      // Promise.all.
      const rpIds = (restrictivePracticeRows ?? []).map((row) => row.id);
      const { data: rpStaffLinkRows } = rpIds.length
        ? await supabase.from("restrictive_practice_staff").select("restrictive_practice_id, incident_staff_id").in("restrictive_practice_id", rpIds)
        : { data: [] };
      const linkedStaffByRpId = new Map<string, string[]>();
      for (const link of rpStaffLinkRows ?? []) {
        linkedStaffByRpId.set(link.restrictive_practice_id, [...(linkedStaffByRpId.get(link.restrictive_practice_id) ?? []), link.incident_staff_id]);
      }

      const byChild: Record<string, RestrictivePracticeRecord[]> = {};
      for (const row of restrictivePracticeRows ?? []) {
        const record: RestrictivePracticeRecord = {
          id: row.id,
          planningStatus: row.planning_status as PlanningStatus | null,
          reasonCodes: row.reason_codes ?? [],
          disengagementCodes: row.disengagement_codes ?? [],
          holdType: row.hold_type as HoldType | null,
          holdPosition: row.hold_position as HoldPosition | null,
          holdLevel: row.hold_level as HoldLevel | null,
          resultCodes: row.result_codes ?? [],
          totalProcedures: row.total_procedures?.toString() ?? "",
          staffInitials: row.staff_initials ?? "",
          linkedStaffIds: linkedStaffByRpId.get(row.id) ?? [],
          ncseReportComplete: row.ncse_report_complete,
          isSaving: false,
          saveError: null,
          savedAt: null,
        };
        byChild[row.passport_id] = [...(byChild[row.passport_id] ?? []), record];
      }
      setRestrictivePracticesByChild(byChild);

      setInjuryTypeOptions((injuryTypeRows ?? []).map((row) => ({ id: row.id, value: row.value })));
      setRegionOptions((regionRows ?? []).map((row) => ({ id: row.id, value: row.value })));
      setInjuries(
        (injuryRows ?? []).map((row) => ({
          id: row.id,
          injuredPartyType: row.injured_party_type as "student" | "staff",
          passportId: row.passport_id,
          staffUserId: row.staff_user_id,
          partyName:
            row.injured_party_type === "student"
              ? nameByPassportId.get(row.passport_id ?? "") || "Unnamed child"
              : row.free_text_name || nameByUserId.get(row.staff_user_id ?? "") || "Named staff member",
          injuryTypes: row.injury_types ?? [],
          injuryNotes: row.injury_notes ?? "",
          firstAiderCalled: row.first_aider_called,
          firstAiderName: row.first_aider_name ?? "",
          doctorAmbulanceCalled: row.doctor_ambulance_called,
          treatments: row.treatments ?? [],
          treatmentOther: row.treatment_other ?? "",
          remainedOnSite: row.remained_on_site,
          remainedDetail: row.remained_detail ?? "",
        }))
      );

      setCategory(incident.category as Category | null);
      setParty((incident.party as Party[] | null) ?? []);
      setPartyOther(incident.party_other ?? "");
      setItemInvolved(incident.item_involved ?? "");
      setNarrative(incident.narrative ?? "");
      setParentSummary(incident.parent_summary ?? "");
      setStaffCountNeeded(incident.staff_count_needed as StaffCount | null);
      setStaffDistressed(incident.staff_distressed as StaffDistressed | null);
      setRiskReductionFuture(incident.risk_reduction_future ?? "");
      setOtherInformation(incident.other_information ?? "");
      setSupportButtonPressed(Boolean(incident.support_button_pressed));
      setSupportAlertId(incident.support_alert_id ?? null);
      setInstitutionId(incident.institution_id ?? null);

      // Existing incident, already "yes" but never linked -- offer
      // candidates on load too, not only on a fresh toggle (setSupport
      // ButtonPressedAndSave's own fetch only fires for a change made
      // this session).
      if (incident.support_button_pressed && !incident.support_alert_id && incident.institution_id) {
        setIsLoadingCandidateAlerts(true);
        supabase
          .from("support_alerts")
          .select("id, room_names, raised_at")
          .eq("institution_id", incident.institution_id)
          .order("raised_at", { ascending: false })
          .limit(10)
          .then(({ data, error }) => {
            if (!isMounted) return;
            setIsLoadingCandidateAlerts(false);
            if (!error) setCandidateSupportAlerts(data ?? []);
          });
      }

      // Already linked from a previous session -- fetch just that one
      // alert's room/time so the "Linked to..." line can say more than
      // "a Support Button alert" (candidateSupportAlerts otherwise stays
      // empty, since the fetch above only runs for the unlinked case).
      if (incident.support_alert_id) {
        supabase
          .from("support_alerts")
          .select("id, room_names, raised_at")
          .eq("id", incident.support_alert_id)
          .maybeSingle()
          .then(({ data, error }) => {
            if (!isMounted || error || !data) return;
            setCandidateSupportAlerts((prev) => (prev ? prev : [data]));
          });
      }

      setIsLocked(Boolean(incident.teacher_signed_at));
      setCanEdit(
        !incident.teacher_signed_at && (incident.created_by === user!.id || incident.owning_teacher_id === user!.id)
      );

      // The debrief is owning-teacher-only, not creator-or-owning-teacher
      // -- matches incident_debriefs' own RLS exactly
      // ("i.owning_teacher_id = auth.uid()", no created_by branch at
      // all), not the broader canEdit used everywhere else on this page.
      setOwningTeacherId(incident.owning_teacher_id);
      setOwningTeacherName(incident.owning_teacher_id ? nameByUserId.get(incident.owning_teacher_id) ?? "the owning teacher" : null);
      setCanEditDebrief(!incident.teacher_signed_at && incident.owning_teacher_id === user!.id);

      setDebriefRequired(incident.debrief_required);
      setAnyoneInjured(incident.anyone_injured);
      setAttestationsRequested(incident.attestations_requested);
      if (debriefRow) {
        setDebriefId(debriefRow.id);
        setDebriefDate(debriefRow.debrief_date ?? "");
        setDebriefStaffPresent(debriefRow.staff_present ?? []);
        setDebriefNotes(debriefRow.notes ?? "");
        setDebriefActionsForManagement(debriefRow.actions_for_management ?? "");
        setDebriefCompletedAt(debriefRow.completed_at);
        setDebriefCompletedByName(
          debriefRow.completed_by ? nameByUserId.get(debriefRow.completed_by) ?? "Unknown staff member" : null
        );
      }

      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
    // reloadKey is intentionally in this array despite never being read
    // in the body -- bumping it is the only reason to re-run this
    // effect from scratch (see its own declaration for why).
  }, [user, params.incidentId, reloadKey]);

  if (!isReady) {
    return null;
  }

  function updateChild(childId: string, patch: Partial<ChildFormState>) {
    setChildren((current) => current.map((c) => (c.id === childId ? { ...c, ...patch } : c)));
  }

  // An incident can involve more than one party -- self, peer, and staff
  // are not mutually exclusive (e.g. a peer conflict a staff member also
  // had to intervene in).
  function toggleParty(value: Party) {
    setParty((current) => (current.includes(value) ? current.filter((v) => v !== value) : [...current, value]));
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

  // Actions taken write immediately (a plain join table, nothing to
  // batch) -- optimistic toggle, reverted on failure.
  async function toggleAction(actionTypeId: string) {
    const supabase = createClient();
    const isSelected = selectedActionTypeIds.includes(actionTypeId);
    setActionsError(null);
    setSelectedActionTypeIds((current) =>
      isSelected ? current.filter((id) => id !== actionTypeId) : [...current, actionTypeId]
    );

    const { error: toggleError } = isSelected
      ? await supabase.from("incident_actions").delete().eq("incident_id", params.incidentId).eq("action_type_id", actionTypeId)
      : await supabase.from("incident_actions").insert({ incident_id: params.incidentId, action_type_id: actionTypeId });

    if (toggleError) {
      setActionsError(toggleError.message);
      setSelectedActionTypeIds((current) =>
        isSelected ? [...current, actionTypeId] : current.filter((id) => id !== actionTypeId)
      );
    }
  }

  async function saveOtherActionDetail(otherActionTypeId: string) {
    const supabase = createClient();
    await supabase
      .from("incident_actions")
      .update({ other_detail: otherActionDetail.trim() || null })
      .eq("incident_id", params.incidentId)
      .eq("action_type_id", otherActionTypeId);
  }

  function addRestrictivePracticeRecord(passportId: string) {
    setRestrictivePracticesByChild((current) => ({
      ...current,
      [passportId]: [...(current[passportId] ?? []), blankRestrictivePracticeRecord()],
    }));
  }

  function removeDraftRestrictivePracticeRecord(passportId: string, index: number) {
    // Only ever called on a record with id === null -- once a record has
    // an id (saved), there's no removal path, matching 0068's own
    // comment: "once a restrictive-practice row exists it is never
    // removed, only ever corrected".
    setRestrictivePracticesByChild((current) => ({
      ...current,
      [passportId]: current[passportId].filter((_, i) => i !== index),
    }));
  }

  function updateRestrictivePracticeRecord(passportId: string, index: number, patch: Partial<RestrictivePracticeRecord>) {
    setRestrictivePracticesByChild((current) => ({
      ...current,
      [passportId]: current[passportId].map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));
  }

  function toggleRestrictivePracticeCode(
    passportId: string,
    index: number,
    field: "reasonCodes" | "disengagementCodes" | "resultCodes",
    codeValue: string
  ) {
    setRestrictivePracticesByChild((current) => ({
      ...current,
      [passportId]: current[passportId].map((r, i) => {
        if (i !== index) return r;
        const has = r[field].includes(codeValue);
        return { ...r, [field]: has ? r[field].filter((c) => c !== codeValue) : [...r[field], codeValue] };
      }),
    }));
  }

  function toggleRestrictivePracticeStaff(passportId: string, index: number, incidentStaffId: string) {
    setRestrictivePracticesByChild((current) => ({
      ...current,
      [passportId]: current[passportId].map((r, i) => {
        if (i !== index) return r;
        const has = r.linkedStaffIds.includes(incidentStaffId);
        return { ...r, linkedStaffIds: has ? r.linkedStaffIds.filter((id) => id !== incidentStaffId) : [...r.linkedStaffIds, incidentStaffId] };
      }),
    }));
  }

  async function saveRestrictivePracticeRecord(passportId: string, index: number) {
    const record = restrictivePracticesByChild[passportId][index];

    if (!record.planningStatus) {
      updateRestrictivePracticeRecord(passportId, index, { saveError: "Planning status is required." });
      return;
    }

    updateRestrictivePracticeRecord(passportId, index, { isSaving: true, saveError: null });

    const supabase = createClient();
    const payload = {
      incident_id: params.incidentId as string,
      passport_id: passportId,
      planning_status: record.planningStatus,
      reason_codes: record.reasonCodes.length > 0 ? record.reasonCodes : null,
      disengagement_codes: record.disengagementCodes.length > 0 ? record.disengagementCodes : null,
      hold_type: record.holdType,
      hold_position: record.holdPosition,
      hold_level: record.holdLevel,
      result_codes: record.resultCodes.length > 0 ? record.resultCodes : null,
      total_procedures: record.totalProcedures.trim() ? parseInt(record.totalProcedures, 10) : null,
      staff_initials: record.staffInitials.trim() || null,
      ncse_report_complete: record.ncseReportComplete,
    };

    let rpId = record.id;

    if (rpId) {
      const { error: updateError } = await supabase.from("restrictive_practices").update(payload).eq("id", rpId);
      if (updateError) {
        updateRestrictivePracticeRecord(passportId, index, { isSaving: false, saveError: updateError.message });
        return;
      }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("restrictive_practices")
        .insert(payload)
        .select("id")
        .single();
      if (insertError) {
        updateRestrictivePracticeRecord(passportId, index, { isSaving: false, saveError: insertError.message });
        return;
      }
      rpId = inserted.id;
    }

    // Staff links: delete-all-then-reinsert-selected. Simpler than
    // diffing against what was originally loaded, and correct either
    // way -- this is a plain "who's linked right now" selection, not an
    // append-only history like attestations.
    const { error: unlinkError } = await supabase.from("restrictive_practice_staff").delete().eq("restrictive_practice_id", rpId);
    if (unlinkError) {
      updateRestrictivePracticeRecord(passportId, index, { isSaving: false, saveError: unlinkError.message, id: rpId });
      return;
    }
    if (record.linkedStaffIds.length > 0) {
      const { error: linkError } = await supabase
        .from("restrictive_practice_staff")
        .insert(record.linkedStaffIds.map((incidentStaffId) => ({ restrictive_practice_id: rpId, incident_staff_id: incidentStaffId })));
      if (linkError) {
        updateRestrictivePracticeRecord(passportId, index, { isSaving: false, saveError: linkError.message, id: rpId });
        return;
      }
    }

    updateRestrictivePracticeRecord(passportId, index, { isSaving: false, savedAt: Date.now(), id: rpId });
  }

  async function handleAddInjury() {
    setAddInjuryError(null);
    if (!newInjuryParty && !newInjuryStaffFreeText.trim()) {
      setAddInjuryError("Choose who this injury record is for.");
      return;
    }

    const supabase = createClient();
    let payload: Record<string, unknown>;
    let injuredPartyType: "student" | "staff";
    let passportId: string | null = null;
    let staffUserId: string | null = null;
    let partyName: string;

    if (newInjuryParty?.kind === "student") {
      injuredPartyType = "student";
      passportId = newInjuryParty.passportId;
      partyName = newInjuryParty.name;
      payload = { incident_id: params.incidentId as string, injured_party_type: "student", passport_id: passportId };
    } else if (newInjuryParty?.kind === "named_staff") {
      injuredPartyType = "staff";
      staffUserId = newInjuryParty.userId;
      partyName = newInjuryParty.name;
      payload = newInjuryParty.userId
        ? { incident_id: params.incidentId as string, injured_party_type: "staff", staff_user_id: newInjuryParty.userId }
        : { incident_id: params.incidentId as string, injured_party_type: "staff", free_text_name: newInjuryParty.freeTextName };
    } else {
      // Genuine fallback -- someone never named on the incident at the stamp.
      injuredPartyType = "staff";
      partyName = newInjuryStaffFreeText.trim();
      payload = { incident_id: params.incidentId as string, injured_party_type: "staff", free_text_name: partyName };
    }

    const { data: inserted, error: insertError } = await supabase.from("incident_injuries").insert(payload).select("id").single();

    if (insertError) {
      setAddInjuryError(insertError.message);
      return;
    }

    setInjuries((current) => [
      ...current,
      {
        id: inserted.id,
        injuredPartyType,
        passportId,
        staffUserId,
        partyName,
        injuryTypes: [],
        injuryNotes: "",
        firstAiderCalled: null,
        firstAiderName: "",
        doctorAmbulanceCalled: null,
        treatments: [],
        treatmentOther: "",
        remainedOnSite: null,
        remainedDetail: "",
      },
    ]);
    setIsAddingInjury(false);
    setNewInjuryParty(null);
    setNewInjuryStaffFreeText("");
  }

  function updateInjuryLocal(injuryId: string, patch: Partial<InjuryRecordState>) {
    setInjuries((current) => current.map((inj) => (inj.id === injuryId ? { ...inj, ...patch } : inj)));
  }

  async function saveInjuryField(injuryId: string, patch: Record<string, unknown>) {
    const supabase = createClient();
    await supabase.from("incident_injuries").update(patch).eq("id", injuryId);
  }

  // injury_types (the per-person multi-select) is deliberately no
  // longer written to -- type belongs to the mark, not the person
  // (0080's own migration comment). The column stays, untouched, so no
  // existing value is lost.

  async function handleRemoveInjury(injuryId: string) {
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("incident_injuries").delete().eq("id", injuryId);
    if (!deleteError) {
      setInjuries((current) => current.filter((inj) => inj.id !== injuryId));
    }
  }

  // Writes straight to incidents.debrief_required the moment the toggle
  // changes -- matching toggleAction()'s immediate-write pattern. This
  // used to only update local state and rely on the far-away top-level
  // Save button to persist it, which meant a real click on this section's
  // OWN save/complete buttons never actually wrote the toggle -- caught
  // live by a direct DB re-query showing debrief_required still false
  // after a UI round that looked fully successful. There is now exactly
  // one write path for this column.
  async function setDebriefRequiredAndSave(value: boolean) {
    const previous = debriefRequired;
    setDebriefRequired(value);
    setDebriefSaveError(null);

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("incidents")
      .update({ debrief_required: value })
      .eq("id", params.incidentId);

    if (updateError) {
      setDebriefRequired(previous);
      setDebriefSaveError(updateError.message);
    }
  }

  async function setAnyoneInjuredAndSave(value: boolean) {
    const previous = anyoneInjured;
    setAnyoneInjured(value);
    setAnyoneInjuredSaveError(null);

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("incidents")
      .update({ anyone_injured: value })
      .eq("id", params.incidentId);

    if (updateError) {
      setAnyoneInjured(previous);
      setAnyoneInjuredSaveError(updateError.message);
    }
  }

  async function setSupportButtonPressedAndSave(value: boolean) {
    const previous = supportButtonPressed;
    setSupportButtonPressed(value);
    setSupportButtonSaveError(null);

    // Flipping back to "no" also clears any linked alert -- the check
    // constraint (0156) refuses support_alert_id set alongside
    // support_button_pressed = false, and a "no" answer shouldn't leave
    // a stale link sitting underneath it.
    const previousAlertId = supportAlertId;
    if (!value) setSupportAlertId(null);

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("incidents")
      .update({ support_button_pressed: value, ...(value ? {} : { support_alert_id: null }) })
      .eq("id", params.incidentId);

    if (updateError) {
      setSupportButtonPressed(previous);
      setSupportAlertId(previousAlertId);
      setSupportButtonSaveError(updateError.message);
      return;
    }

    // Yes, and nothing linked yet -- offer candidate alerts to link.
    // Migration 0153's own RLS on support_alerts already scopes this to
    // the caller's own institution; no institution filter needed beyond
    // eq() below since RLS enforces it anyway, but it's included for an
    // index-friendly query, matching support_alerts_open_idx's own
    // (institution_id) shape.
    if (value && !previousAlertId && institutionId) {
      setIsLoadingCandidateAlerts(true);
      const { data, error } = await supabase
        .from("support_alerts")
        .select("id, room_names, raised_at")
        .eq("institution_id", institutionId)
        .order("raised_at", { ascending: false })
        .limit(10);
      setIsLoadingCandidateAlerts(false);
      if (!error) setCandidateSupportAlerts(data ?? []);
    }
  }

  async function setSupportAlertIdAndSave(alertId: string | null) {
    const previous = supportAlertId;
    setSupportAlertId(alertId);
    setSupportAlertSaveError(null);

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("incidents")
      .update({ support_alert_id: alertId })
      .eq("id", params.incidentId);

    if (updateError) {
      setSupportAlertId(previous);
      setSupportAlertSaveError(updateError.message);
    }
  }

  // Parent-call flag -- per child (incident_children), immediate write
  // like debrief_required/anyone_injured above, not batched into the
  // main Save. One-way in the UI: the toggle is only ever offered while
  // false -- injuries/restrictive practice can also flip it true
  // automatically, and 0068's own trigger comment is explicit that it
  // never goes back to false once set ("a physical injury or
  // restrictive practice was used" doesn't un-happen). A raw update
  // COULD technically still write false (no DB-level guard against it),
  // but the UI simply never offers that action.
  async function setParentCallRequiredAndSave(childId: string) {
    setParentCallSaveError(null);
    updateChild(childId, { parentCallRequired: true });

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("incident_children")
      .update({ parent_call_required: true })
      .eq("id", childId);

    if (updateError) {
      updateChild(childId, { parentCallRequired: false });
      setParentCallSaveError(updateError.message);
    }
  }

  async function markParentCalled(childId: string) {
    setParentCallSaveError(null);
    setMarkingCalledChildId(childId);

    const supabase = createClient();
    const { error: callError } = await supabase.rpc("mark_parent_called", { p_incident_children_id: childId });

    if (callError) {
      setParentCallSaveError(callError.message);
      setMarkingCalledChildId(null);
      return;
    }

    const { data: refreshedRow } = await supabase
      .from("incident_children")
      .select("parent_called_at, parent_called_by")
      .eq("id", childId)
      .single();

    if (refreshedRow) {
      updateChild(childId, { parentCalledAt: refreshedRow.parent_called_at, parentCalledBy: refreshedRow.parent_called_by });
    }
    setMarkingCalledChildId(null);
  }

  function addDebriefStaffPresent() {
    const name = debriefStaffInput.trim();
    if (!name || debriefStaffPresent.includes(name)) return;
    setDebriefStaffPresent((current) => [...current, name]);
    setDebriefStaffInput("");
  }

  function removeDebriefStaffPresent(name: string) {
    setDebriefStaffPresent((current) => current.filter((n) => n !== name));
  }

  // Owning-teacher-only, matching incident_debriefs' RLS exactly. Fields
  // save independently of the top-level Save button (same pattern as
  // restrictive practice) -- a debrief can exist in a part-filled state
  // right up until it's explicitly marked complete.
  async function handleSaveDebrief() {
    if (!debriefDate) {
      setDebriefSaveError("Date of debrief is required.");
      return;
    }

    setIsSavingDebrief(true);
    setDebriefSaveError(null);

    const supabase = createClient();
    const payload = {
      incident_id: params.incidentId as string,
      debrief_date: debriefDate,
      staff_present: debriefStaffPresent.length > 0 ? debriefStaffPresent : null,
      notes: debriefNotes.trim() || null,
      actions_for_management: debriefActionsForManagement.trim() || null,
    };

    if (debriefId) {
      const { error: updateError } = await supabase.from("incident_debriefs").update(payload).eq("id", debriefId);
      setIsSavingDebrief(false);
      if (updateError) {
        setDebriefSaveError(updateError.message);
        return;
      }
      setDebriefSavedAt(Date.now());
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("incident_debriefs")
        .insert(payload)
        .select("id")
        .single();
      setIsSavingDebrief(false);
      if (insertError) {
        setDebriefSaveError(insertError.message);
        return;
      }
      setDebriefId(inserted.id);
      setDebriefSavedAt(Date.now());
    }
  }

  // A deliberate, separate action -- "saved" and "complete" are not the
  // same thing. Only a completed debrief (completed_at set) satisfies
  // the sign-off gate (migration 0077); this is the only place that
  // column is ever written.
  async function handleMarkDebriefComplete() {
    if (!debriefId) {
      setDebriefSaveError("Save the debrief before marking it complete.");
      return;
    }
    setIsCompletingDebrief(true);
    setDebriefSaveError(null);

    const supabase = createClient();
    const now = new Date().toISOString();
    const { error: completeError } = await supabase
      .from("incident_debriefs")
      .update({ completed_at: now, completed_by: owningTeacherId })
      .eq("id", debriefId);

    setIsCompletingDebrief(false);
    if (completeError) {
      setDebriefSaveError(completeError.message);
      return;
    }
    setDebriefCompletedAt(now);
    setDebriefCompletedByName(owningTeacherName);
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveError(null);

    const supabase = createClient();

    // PRD 1, Stage 3 finding, fixed alongside the mid-session design
    // work: this update never chained .select(), so RLS silently
    // filtering it (CLAUDE.md's own first documented gotcha -- a
    // .update() whose target fails the policy's USING clause returns
    // {data: [], error: null}, no thrown error) meant a lapsed-access
    // save previously showed FALSE SUCCESS, not even an error. Now
    // chains .select("id") and checks the row actually came back --
    // safe here specifically because anyone who could pass the
    // narrower UPDATE policy (owning_teacher_id + can_own_incident() +
    // has_child_access()) already trivially satisfies the broader
    // can_view_incident() SELECT policy via its own unconditional
    // created_by/owning_teacher_id branches (confirmed live, CHECK
    // AA-7e), so this isn't the insert-before-children ordering trap
    // CLAUDE.md's second gotcha warns about.
    const { data: updatedIncidentRows, error: incidentUpdateError } = await supabase
      .from("incidents")
      .update({
        category,
        party: party.length > 0 ? party : null,
        party_other: partyOther.trim() || null,
        item_involved: itemInvolved.trim() || null,
        narrative: narrative.trim() || null,
        parent_summary: parentSummary.trim() || null,
        staff_count_needed: staffCountNeeded,
        staff_distressed: staffDistressed,
        risk_reduction_future: riskReductionFuture.trim() || null,
        other_information: otherInformation.trim() || null,
      })
      .eq("id", params.incidentId)
      .select("id");

    if (incidentUpdateError) {
      setIsSaving(false);
      setSaveError(incidentUpdateError.message);
      return;
    }
    if (!updatedIncidentRows || updatedIncidentRows.length === 0) {
      setIsSaving(false);
      setSaveError(friendlyAccessLapsedMessage("This incident"));
      return;
    }

    for (const child of children) {
      const { data: updatedChildRows, error: childUpdateError } = await supabase
        .from("incident_children")
        .update({
          distress_level: child.distressLevel,
          remained_on_site: child.remainedOnSite,
          remained_detail: child.remainedDetail.trim() || null,
          recovery_methods: child.recoveryMethods.length > 0 ? child.recoveryMethods : null,
          recovery_methods_other: child.recoveryMethodsOther.trim() || null,
        })
        .eq("id", child.id)
        .select("id");

      if (childUpdateError) {
        setIsSaving(false);
        setSaveError(childUpdateError.message);
        return;
      }
      if (!updatedChildRows || updatedChildRows.length === 0) {
        setIsSaving(false);
        setSaveError(friendlyAccessLapsedMessage("This incident"));
        return;
      }
    }

    setIsSaving(false);
    setSavedAt(Date.now());
  }

  const staffRole = user?.app_metadata?.role as string | undefined;
  const restraintAction = actionTypes.find((a) => a.isRestraint);
  const hasCpiSelected = Boolean(restraintAction && selectedActionTypeIds.includes(restraintAction.id));

  return (
    // PRD 4, Stage 3 -- extra bottom clearance below lg whenever
    // CountersignCard might dock its own action buttons as a fixed
    // footer (see that component). Harmless on the already-countersigned
    // branch too (that state renders no footer) -- just some unused
    // white space at the foot of the page, not worth threading that
    // narrower condition up through this many levels of nesting.
    <div className={`flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-10 ${isLocked ? "pb-40 lg:pb-10" : ""}`}>
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
          // PRD 4, Stage 3 -- the split pane is specifically the
          // countersign moment: isLocked && user is the exact condition
          // CountersignCard's own render is gated on below, so the grid
          // and the card either both apply or neither does. At <lg this
          // is inert (flex flex-col gap-6, identical spacing to before
          // this stage -- the outer gap-6 falls between the two wrapper
          // divs, the inner gap-6 falls between the report's own
          // children, both 6-unit, so nothing visibly changes). Every
          // OTHER state of this page (mid-form, awaiting attestations,
          // not yet signed off) never reaches this condition and stays
          // single-column exactly as it always has.
          <div className={`flex flex-col gap-6 ${isLocked ? "lg:grid lg:grid-cols-12 lg:items-start lg:gap-6" : ""}`}>
          <div className={isLocked ? "flex flex-col gap-6 lg:col-span-8" : "contents"}>
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
              <>
                <p className="rounded-2xl border border-brand-golden-brown/30 bg-brand-golden-brown/10 p-4 text-sm text-brand-neutral-black">
                  This incident is teacher-signed and immutable. Corrections go through an amendment, not this form.
                </p>
                {/* Export -- Phase 6, moved here from the bottom of the
                    page (2026-08-27): once signed, exporting the record
                    is one of the main reasons anyone comes to this page
                    at all -- it shouldn't sit past the whole form and
                    the attestation/countersign cards. get_incident_export()'s
                    own can_view_incident() gate is the real access
                    control; this link is just where it's reasonable to
                    surface the entry point. */}
                <Link
                  href={`/teacher/incidents/${params.incidentId}/print`}
                  className="block rounded-2xl bg-brand-prussian-blue py-3.5 text-center text-base font-semibold text-white shadow-sm"
                >
                  Export incident report
                </Link>
              </>
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
                    <PillMultiSelect
                      options={PARTY_OPTIONS.map((o) => ({ value: o.label }))}
                      selected={party.map((p) => PARTY_OPTIONS.find((o) => o.value === p)?.label ?? p)}
                      onToggle={(label) => {
                        const opt = PARTY_OPTIONS.find((o) => o.label === label);
                        if (opt) toggleParty(opt.value);
                      }}
                    />
                    {party.includes("other") && (
                      <TextField
                        label="Party -- other, please specify"
                        id="party-other"
                        value={partyOther}
                        onChange={(e) => setPartyOther(e.target.value)}
                        placeholder="Optional"
                        className="mt-3"
                      />
                    )}
                  </div>

                  <TextField
                    label="Item involved"
                    id="item-involved"
                    value={itemInvolved}
                    onChange={(e) => setItemInvolved(e.target.value)}
                    placeholder="e.g. fall from swing, cut from scissors"
                  />

                  <Textarea
                    label="What happened?"
                    id="narrative"
                    value={narrative}
                    onChange={(e) => setNarrative(e.target.value)}
                    rows={5}
                    placeholder="Brief factual outline of significant details leading up to the incident (i.e. precursors, setting events)"
                  />

                  <Textarea
                    label="Parent summary"
                    id="parent-summary"
                    value={parentSummary}
                    onChange={(e) => setParentSummary(e.target.value)}
                    rows={3}
                  />
                </div>
              </section>

              <section>
                <h2 className="mb-1 font-heading text-lg font-bold text-brand-prussian-blue">What did you do?</h2>
                <p className="mb-3 text-sm text-brand-neutral-black/60">
                  Actions taken, minimising risk i.e. de-escalation, positive interventions, environmental adaptions.
                </p>
                <div className="rounded-2xl border border-black/5 bg-white p-4">
                  <div className="flex flex-wrap gap-2">
                    {actionTypes
                      .filter((action) => !action.isRestraint)
                      .map((action) => {
                      const isSelected = selectedActionTypeIds.includes(action.id);
                      return (
                        <button
                          key={action.id}
                          type="button"
                          onClick={() => toggleAction(action.id)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                            isSelected
                              ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                              : "border-black/10 bg-white text-black/60 hover:bg-black/[0.02]"
                          }`}
                        >
                          {action.value}
                        </button>
                      );
                    })}
                  </div>
                  {actionsError && (
                    <p role="alert" className="mt-2 text-sm font-medium text-red-600">
                      {actionsError}
                    </p>
                  )}
                  {(() => {
                    const otherAction = actionTypes.find((a) => a.value === "Other");
                    if (!otherAction || !selectedActionTypeIds.includes(otherAction.id)) return null;
                    return (
                      <TextField
                        label="Other -- please specify"
                        id="action-other-detail"
                        value={otherActionDetail}
                        onChange={(e) => setOtherActionDetail(e.target.value)}
                        onBlur={() => saveOtherActionDetail(otherAction.id)}
                        placeholder="Optional"
                        className="mt-3"
                      />
                    );
                  })()}
                </div>
              </section>

              {restraintAction && (
                <section>
                  <div
                    className={`rounded-2xl border-2 p-4 ${
                      hasCpiSelected
                        ? "border-brand-golden-brown bg-brand-golden-brown/10"
                        : "border-brand-golden-brown/40 bg-white"
                    }`}
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={hasCpiSelected}
                        onChange={() => toggleAction(restraintAction.id)}
                        className="mt-1 h-5 w-5 flex-shrink-0 accent-brand-golden-brown"
                      />
                      <span>
                        <span className="block font-heading text-lg font-bold text-brand-prussian-blue">
                          CPI / restraint used
                        </span>
                        <span className="mt-0.5 block text-sm text-brand-neutral-black/70">
                          Tick only if physical restraint (CPI) was used during this incident -- this opens the
                          restrictive practice record below, added deliberately, never permanently present.
                        </span>
                      </span>
                    </label>
                  </div>
                </section>
              )}

              <div className="flex flex-col gap-5 rounded-2xl border border-black/5 bg-white p-4">
                <div>
                  <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">
                    How many staff were needed to manage the incident safely?
                  </span>
                  <PillSingleSelect options={STAFF_COUNT_OPTIONS} value={staffCountNeeded} onChange={setStaffCountNeeded} />
                </div>

                <div>
                  <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">
                    Did staff member/s find this incident distressing?
                  </span>
                  <PillSingleSelect
                    options={STAFF_DISTRESSED_OPTIONS}
                    value={staffDistressed}
                    onChange={setStaffDistressed}
                  />
                </div>

                <Textarea
                  label="How can we reduce the risks in future?"
                  id="risk-reduction-future"
                  value={riskReductionFuture}
                  onChange={(e) => setRiskReductionFuture(e.target.value)}
                  rows={3}
                  placeholder="e.g. proactive strategies, deescalation, positioning to reduce risk"
                />

                <Textarea
                  label="Any other information:"
                  id="other-information"
                  value={otherInformation}
                  onChange={(e) => setOtherInformation(e.target.value)}
                  rows={3}
                />
              </div>

              {children.map((child) => (
                <section key={child.id}>
                  <h2 className="mb-3 font-heading text-lg font-bold text-brand-prussian-blue">
                    {child.childName} -- Impact
                  </h2>

                  <div className="flex flex-col gap-5 rounded-2xl border border-black/5 bg-white p-4">
                    <div>
                      <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">
                        Was {child.childName} distressed?
                      </span>
                      <PillSingleSelect
                        options={DISTRESS_LEVEL_OPTIONS}
                        value={child.distressLevel}
                        onChange={(v) => updateChild(child.id, { distressLevel: v })}
                      />
                    </div>

                    <div>
                      <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">
                        Did {child.childName} remain on site for remainder of school day?
                      </span>
                      <PillSingleSelect
                        options={REMAINED_ON_SITE_OPTIONS}
                        value={child.remainedOnSite === null ? null : child.remainedOnSite ? "yes" : "no"}
                        onChange={(v) => updateChild(child.id, { remainedOnSite: v === "yes" })}
                      />
                    </div>

                    <TextField
                      label="If no, provide detail"
                      id={`remained-detail-${child.id}`}
                      value={child.remainedDetail}
                      onChange={(e) => updateChild(child.id, { remainedDetail: e.target.value })}
                      placeholder="e.g. Parent collected child"
                    />

                    <div>
                      <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">
                        How was {child.childName} assisted to recover/repair relationships with staff/pupil?
                      </span>
                      <PillMultiSelect
                        options={recoveryOptions.map((v) => ({ value: v }))}
                        selected={child.recoveryMethods}
                        onToggle={(v) => toggleRecoveryMethod(child.id, v)}
                      />
                      {child.recoveryMethods.includes("Other") && (
                        <TextField
                          label="Other -- please specify"
                          id={`recovery-other-${child.id}`}
                          value={child.recoveryMethodsOther}
                          onChange={(e) => updateChild(child.id, { recoveryMethodsOther: e.target.value })}
                          placeholder="Optional"
                          className="mt-3"
                        />
                      )}
                    </div>

                    {/* Parent contact facts -- ALWAYS visible, migration
                        0152. Three separate evidential facts (we sent a
                        notice / we telephoned them / they acknowledged
                        having seen it), each its own line so none reads
                        as standing in for another. Previously this
                        entire section only rendered when
                        parentCallRequired was true -- meaning a notice
                        WAS sent (automatic, every incident) but a
                        school had no way to see that in the common case
                        (no call required). Found while scoping the
                        acknowledge button, fixed alongside it. Golden
                        Brown for the two facts that are the school's
                        own completed actions; muted neutral for
                        acknowledged-or-not -- its absence must never
                        read as the school having failed to notify. */}
                    <div className="border-t border-black/[0.06] pt-4">
                      <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Parent contact</span>
                      <div className="flex flex-col gap-1.5">
                        {child.parentNotifiedAt ? (
                          <p className="text-sm text-brand-golden-brown">
                            Notice sent {formatDateTime(child.parentNotifiedAt)}.
                          </p>
                        ) : child.parentNotificationBlockedReason !== "dormant_account" ? (
                          <p className="text-sm text-brand-neutral-black/50">No notice recorded.</p>
                        ) : null}
                        {child.parentCalledAt && (
                          <p className="text-sm text-brand-golden-brown">
                            Parent called {formatDateTime(child.parentCalledAt)}
                            {child.parentCalledBy && ` by ${staffNameById.get(child.parentCalledBy) || "a staff member"}`}.
                          </p>
                        )}
                        {child.parentAcknowledgedAt ? (
                          <p className="text-sm text-brand-golden-brown">
                            Acknowledged by parent {formatDateTime(child.parentAcknowledgedAt)}.
                          </p>
                        ) : (
                          <p className="text-sm text-brand-neutral-black/50">Not yet acknowledged by parent.</p>
                        )}
                      </div>

                      {child.parentNotificationBlockedReason === "dormant_account" && (
                        <p className="mt-3 rounded-xl border border-brand-golden-brown/30 bg-brand-golden-brown/10 p-3 text-sm text-brand-neutral-black">
                          This parent hasn&apos;t signed in and can&apos;t be notified in the app — contact them
                          directly.
                        </p>
                      )}
                    </div>

                    {/* Parent call required? -- the ACTION workflow,
                        separate from the facts above. Unchanged except
                        for the "already called" fact display moving up
                        into the always-visible block -- this stays
                        conditional because it's a task, not a fact. */}
                    <div className="border-t border-black/[0.06] pt-4">
                      <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Parent call required?</span>
                      {child.parentCallRequired ? (
                        <span className="inline-block rounded-full border border-brand-golden-brown bg-brand-golden-brown/10 px-3 py-1.5 text-xs font-semibold text-brand-golden-brown">
                          Yes
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-brand-prussian-blue bg-brand-pastel-blue/30 px-3 py-1.5 text-xs font-semibold text-brand-prussian-blue">
                            No
                          </span>
                          <button
                            type="button"
                            onClick={() => setParentCallRequiredAndSave(child.id)}
                            className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-black/60 transition-colors hover:bg-black/[0.02]"
                          >
                            Yes
                          </button>
                        </div>
                      )}

                      {child.parentCallRequired && !child.parentCalledAt && (
                        <div className="mt-3">
                          {/* Instruction, not an error -- the teacher is
                              being asked to do something away from the
                              app before this button is meaningful. Plain
                              copy, no Golden Brown alarm box (that
                              treatment is reserved for real inconsistency
                              warnings elsewhere on this page). */}
                          <p className="mb-2 text-sm text-brand-neutral-black/70">
                            Please get in contact with the child&apos;s parent, then return to continue with this
                            report.
                          </p>
                          <Button
                            type="button"
                            onClick={() => markParentCalled(child.id)}
                            disabled={markingCalledChildId === child.id}
                            className="!w-auto !bg-brand-golden-brown !px-4 !py-2 !text-sm"
                          >
                            {markingCalledChildId === child.id ? "Recording…" : "Mark parent called"}
                          </Button>
                        </div>
                      )}

                      {parentCallSaveError && (
                        <p role="alert" className="mt-2 text-sm font-medium text-red-600">
                          {parentCallSaveError}
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              ))}

              {children.map((child) => {
                  const records = restrictivePracticesByChild[child.passportId] ?? [];
                  // A record survives even if the toggle above gets
                  // unticked (existing rows are never removed, only
                  // corrected) -- so the section stays visible whenever
                  // a record exists, regardless of the toggle, or a
                  // teacher who unticked by mistake would have no way
                  // to see what they've orphaned before hitting a
                  // sign-off error naming a record that isn't on screen.
                  // The trigger (0083) is the correctness boundary;
                  // this is about being able to see and fix what it
                  // will stop you on.
                  if (!hasCpiSelected && records.length === 0) return null;
                  return (
                    <section key={`rp-${child.id}`}>
                      <h2 className="mb-3 font-heading text-lg font-bold text-brand-prussian-blue">
                        {child.childName} -- Restrictive Practice
                      </h2>

                      {!hasCpiSelected && records.length > 0 && (
                        <p className="mb-3 rounded-xl border border-brand-golden-brown bg-brand-golden-brown/10 p-3 text-sm text-brand-neutral-black">
                          <strong>Inconsistent:</strong> a restrictive practice record exists below, but &quot;CPI /
                          restraint used&quot; is currently unticked. This will block sign-off. Re-tick it above if
                          restraint was used, or this record needs to be corrected.
                        </p>
                      )}

                      <div className="flex flex-col gap-4">
                        {records.map((record, index) => (
                          <div key={record.id ?? `draft-${index}`} className="rounded-2xl border border-black/5 bg-white p-4">
                            <div className="flex flex-col gap-5">
                              <div>
                                <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">
                                  Planning status <span className="text-brand-golden-brown">Required</span>
                                </span>
                                <PillSingleSelect
                                  options={PLANNING_STATUS_OPTIONS}
                                  value={record.planningStatus}
                                  onChange={(v) => updateRestrictivePracticeRecord(child.passportId, index, { planningStatus: v })}
                                />
                              </div>

                              <div>
                                <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Reason</span>
                                <PillMultiSelect
                                  options={cpiReasonOptions.map((v) => ({ value: v }))}
                                  selected={record.reasonCodes}
                                  onToggle={(v) => toggleRestrictivePracticeCode(child.passportId, index, "reasonCodes", v)}
                                />
                              </div>

                              <div>
                                <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Disengagement</span>
                                <PillMultiSelect
                                  options={cpiDisengagementOptions.map((v) => ({ value: v }))}
                                  selected={record.disengagementCodes}
                                  onToggle={(v) => toggleRestrictivePracticeCode(child.passportId, index, "disengagementCodes", v)}
                                />
                              </div>

                              <div>
                                <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Hold type</span>
                                <PillSingleSelect
                                  options={HOLD_TYPE_OPTIONS}
                                  value={record.holdType}
                                  onChange={(v) => updateRestrictivePracticeRecord(child.passportId, index, { holdType: v })}
                                />
                              </div>

                              <div>
                                <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Hold position</span>
                                <PillSingleSelect
                                  options={HOLD_POSITION_OPTIONS}
                                  value={record.holdPosition}
                                  onChange={(v) => updateRestrictivePracticeRecord(child.passportId, index, { holdPosition: v })}
                                />
                              </div>

                              <div>
                                <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Hold level</span>
                                {/* Deliberate, narrow exception to the module's colour rules --
                                    escalating physical force is exactly where a reader's eye
                                    should be drawn. Standard semantic red/amber/green, never
                                    the Calm red pair, used only on these three pills. Colour
                                    is never the only signal -- the pill's own label (Low/
                                    Medium/High) is always readable underneath it. */}
                                <div className="flex flex-wrap gap-2">
                                  {HOLD_LEVEL_OPTIONS.map((option) => {
                                    const isSelected = record.holdLevel === option.value;
                                    const selectedClass =
                                      option.value === "low"
                                        ? "border-green-600 bg-green-100 text-green-800"
                                        : option.value === "med"
                                          ? "border-amber-600 bg-amber-100 text-amber-800"
                                          : "border-red-600 bg-red-100 text-red-800";
                                    return (
                                      <button
                                        key={option.value}
                                        type="button"
                                        onClick={() =>
                                          updateRestrictivePracticeRecord(child.passportId, index, { holdLevel: option.value })
                                        }
                                        className={`rounded-full border-2 px-3 py-1.5 text-xs font-semibold transition-colors ${
                                          isSelected ? selectedClass : "border-black/10 bg-white text-black/60 hover:bg-black/[0.02]"
                                        }`}
                                      >
                                        {option.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              <div>
                                <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Result</span>
                                <PillMultiSelect
                                  options={cpiResultOptions.map((v) => ({ value: v }))}
                                  selected={record.resultCodes}
                                  onToggle={(v) => toggleRestrictivePracticeCode(child.passportId, index, "resultCodes", v)}
                                />
                              </div>

                              <TextField
                                label="Total no. of procedures used:"
                                id={`total-procedures-${child.id}-${index}`}
                                type="number"
                                min={0}
                                value={record.totalProcedures}
                                onChange={(e) =>
                                  updateRestrictivePracticeRecord(child.passportId, index, { totalProcedures: e.target.value })
                                }
                              />

                              <div>
                                <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">
                                  Staff involved
                                </span>
                                <p className="mb-2 text-xs text-brand-neutral-black/50">
                                  Only staff with an account can be linked here -- a restraint record has to trace
                                  back to a named, accountable individual.
                                </p>
                                {incidentStaffOptions.length === 0 ? (
                                  <p className="text-sm text-brand-neutral-black/60">
                                    No staff with an account are named on this incident yet -- add them at the staff
                                    step first.
                                  </p>
                                ) : (
                                  <PillMultiSelect
                                    options={incidentStaffOptions.map((s) => ({ value: s.name, fullName: s.name }))}
                                    selected={record.linkedStaffIds
                                      .map((id) => incidentStaffOptions.find((s) => s.id === id)?.name)
                                      .filter((name): name is string => Boolean(name))}
                                    onToggle={(name) => {
                                      const staffMember = incidentStaffOptions.find((s) => s.name === name);
                                      if (staffMember) toggleRestrictivePracticeStaff(child.passportId, index, staffMember.id);
                                    }}
                                  />
                                )}
                                {record.staffInitials && (
                                  <p className="mt-2 text-xs text-brand-neutral-black/50">
                                    Previously recorded initials (read-only, no longer written to): {record.staffInitials}
                                  </p>
                                )}
                              </div>

                              <div>
                                <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">
                                  NCSE report complete?
                                </span>
                                <PillSingleSelect
                                  options={REMAINED_ON_SITE_OPTIONS}
                                  value={record.ncseReportComplete === null ? null : record.ncseReportComplete ? "yes" : "no"}
                                  onChange={(v) =>
                                    updateRestrictivePracticeRecord(child.passportId, index, { ncseReportComplete: v === "yes" })
                                  }
                                />
                              </div>

                              {record.saveError && (
                                <p role="alert" className="text-sm font-medium text-red-600">
                                  {record.saveError}
                                </p>
                              )}
                              {record.savedAt && !record.saveError && (
                                <p className="text-sm font-medium text-green-700">Saved.</p>
                              )}

                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  onClick={() => saveRestrictivePracticeRecord(child.passportId, index)}
                                  disabled={record.isSaving}
                                >
                                  {record.isSaving ? "Saving…" : record.id ? "Update" : "Save"}
                                </Button>
                                {record.id === null && (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => removeDraftRestrictivePracticeRecord(child.passportId, index)}
                                  >
                                    Remove
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}

                        {hasCpiSelected && (
                          <button
                            type="button"
                            onClick={() => addRestrictivePracticeRecord(child.passportId)}
                            className="rounded-2xl border-2 border-dashed border-brand-prussian-blue/30 py-3 text-sm font-semibold text-brand-prussian-blue"
                          >
                            + Add a restrictive practice record
                          </button>
                        )}
                      </div>
                    </section>
                  );
                })}

              <section>
                <h2 className="mb-1 font-heading text-lg font-bold text-brand-prussian-blue">Support Button</h2>
                <div className="mb-3">
                  <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">
                    Was the Support Button pressed?
                  </span>
                  <PillSingleSelect
                    options={REMAINED_ON_SITE_OPTIONS}
                    value={supportButtonPressed ? "yes" : "no"}
                    onChange={(v) => setSupportButtonPressedAndSave(v === "yes")}
                  />
                  {supportButtonSaveError && (
                    <p role="alert" className="mt-2 text-sm font-medium text-red-600">
                      {supportButtonSaveError}
                    </p>
                  )}
                </div>

                {/* Migration 0156, item 7's own dependency -- which
                    specific alert this incident is about, so the
                    principal's outstanding-actions bucket can auto-
                    satisfy follow-up when this incident references it.
                    Only offered once "yes" is answered; a genuine "yes,
                    but I don't know/can't find which alert" is left
                    unlinked rather than forced -- support_alert_id stays
                    nullable for exactly that case. */}
                {supportButtonPressed && (
                  <div className="mb-3">
                    {supportAlertId ? (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-support-red/30 bg-brand-support-red/5 px-3 py-2">
                        <p className="font-sans text-sm text-brand-neutral-black">
                          {(() => {
                            const linked = candidateSupportAlerts?.find((a) => a.id === supportAlertId);
                            if (!linked) return "Linked to a Support Button alert.";
                            const room = linked.room_names.length > 0 ? linked.room_names.join(", ") : "no room named";
                            const time = new Date(linked.raised_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            });
                            return `Linked to the alert raised at ${time} - ${room}`;
                          })()}
                        </p>
                        <button
                          type="button"
                          onClick={() => setSupportAlertIdAndSave(null)}
                          className="flex-shrink-0 font-sans text-sm font-semibold text-brand-prussian-blue"
                        >
                          Unlink
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">
                          Which alert? (optional)
                        </span>
                        {isLoadingCandidateAlerts ? (
                          <p className="text-sm text-brand-neutral-black/60">Loading recent alerts…</p>
                        ) : candidateSupportAlerts && candidateSupportAlerts.length > 0 ? (
                          <div className="flex flex-col gap-2">
                            {candidateSupportAlerts.map((alert) => {
                              const room = alert.room_names.length > 0 ? alert.room_names.join(", ") : "No room named";
                              const time = new Date(alert.raised_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              });
                              return (
                                <button
                                  key={alert.id}
                                  type="button"
                                  onClick={() => setSupportAlertIdAndSave(alert.id)}
                                  className="rounded-xl border border-black/10 bg-white px-3 py-2 text-left font-sans text-sm text-brand-neutral-black"
                                >
                                  {time} - {room}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-sm text-brand-neutral-black/60">
                            No recent Support Button alerts found to link.
                          </p>
                        )}
                        {supportAlertSaveError && (
                          <p role="alert" className="mt-2 text-sm font-medium text-red-600">
                            {supportAlertSaveError}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
              </section>

              <section>
                <h2 className="mb-1 font-heading text-lg font-bold text-brand-prussian-blue">Injuries</h2>
                <p className="mb-3 text-sm text-brand-neutral-black/60">
                  Each injured person gets their own record -- one person, one record. Add a separate one for every
                  person affected.
                </p>

                <div className="mb-3">
                  <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">
                    Was a student or staff member injured?
                  </span>
                  <PillSingleSelect
                    options={REMAINED_ON_SITE_OPTIONS}
                    value={anyoneInjured === null ? null : anyoneInjured ? "yes" : "no"}
                    onChange={(v) => setAnyoneInjuredAndSave(v === "yes")}
                  />
                  {anyoneInjuredSaveError && (
                    <p role="alert" className="mt-2 text-sm font-medium text-red-600">
                      {anyoneInjuredSaveError}
                    </p>
                  )}
                </div>

                {anyoneInjured !== true && injuries.length > 0 && (
                  <p className="mb-3 rounded-xl border border-brand-golden-brown bg-brand-golden-brown/10 p-3 text-sm text-brand-neutral-black">
                    <strong>Inconsistent:</strong> injury record(s) exist below, but &quot;Was a student or staff
                    member injured?&quot; is currently {anyoneInjured === false ? "answered No" : "not answered"}.
                    This will block sign-off. Answer Yes above if it&apos;s accurate, or these records need to be
                    corrected.
                  </p>
                )}

                <div className="flex flex-col gap-4">
                  {injuries.map((injury) => (
                    <div key={injury.id} className="flex flex-col gap-4">
                      <div className="flex items-center justify-between px-1">
                        <span className="font-heading text-base font-bold text-brand-prussian-blue">{injury.partyName}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveInjury(injury.id)}
                          className="text-xs font-semibold text-brand-golden-brown"
                        >
                          Remove record
                        </button>
                      </div>

                      {/* Body map at the top of the record, per the brief --
                          above the welfare fields, not below them. */}
                      <BodyMapCard
                        injuryId={injury.id}
                        partyName={injury.partyName}
                        canEdit={canEdit}
                        injuryTypeOptions={injuryTypeOptions}
                        regionOptions={regionOptions}
                      />

                      <div className="rounded-2xl border border-black/5 bg-white p-4">
                        <div className="flex flex-col gap-4">
                          <div>
                            <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">
                              Did injured party remain on site for remainder of school day?
                            </span>
                            <PillSingleSelect
                              options={REMAINED_ON_SITE_OPTIONS}
                              value={injury.remainedOnSite === null ? null : injury.remainedOnSite ? "yes" : "no"}
                              onChange={(v) => {
                                const val = v === "yes";
                                updateInjuryLocal(injury.id, { remainedOnSite: val });
                                saveInjuryField(injury.id, { remained_on_site: val });
                              }}
                            />
                          </div>

                          {injury.remainedOnSite === false && (
                            <TextField
                              label="If no, provide details"
                              id={`remained-detail-injury-${injury.id}`}
                              value={injury.remainedDetail}
                              onChange={(e) => updateInjuryLocal(injury.id, { remainedDetail: e.target.value })}
                              onBlur={() => saveInjuryField(injury.id, { remained_detail: injury.remainedDetail.trim() || null })}
                              placeholder="e.g. Parent collected child"
                            />
                          )}

                          <div>
                            <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">
                              First aider called?
                            </span>
                            <PillSingleSelect
                              options={REMAINED_ON_SITE_OPTIONS}
                              value={injury.firstAiderCalled === null ? null : injury.firstAiderCalled ? "yes" : "no"}
                              onChange={(v) => {
                                const val = v === "yes";
                                updateInjuryLocal(injury.id, { firstAiderCalled: val });
                                saveInjuryField(injury.id, { first_aider_called: val });
                              }}
                            />
                          </div>

                          {injury.firstAiderCalled === true && (
                            <TextField
                              label="If yes, who?"
                              id={`first-aider-name-${injury.id}`}
                              value={injury.firstAiderName}
                              onChange={(e) => updateInjuryLocal(injury.id, { firstAiderName: e.target.value })}
                              onBlur={() => saveInjuryField(injury.id, { first_aider_name: injury.firstAiderName.trim() || null })}
                            />
                          )}

                          <div>
                            <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">
                              Doctor / Ambulance called?
                            </span>
                            <PillSingleSelect
                              options={REMAINED_ON_SITE_OPTIONS}
                              value={injury.doctorAmbulanceCalled === null ? null : injury.doctorAmbulanceCalled ? "yes" : "no"}
                              onChange={(v) => {
                                const val = v === "yes";
                                updateInjuryLocal(injury.id, { doctorAmbulanceCalled: val });
                                saveInjuryField(injury.id, { doctor_ambulance_called: val });
                              }}
                            />
                          </div>

                          <div>
                            <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Treatment</span>
                            <div className="flex flex-wrap gap-2">
                              {TREATMENT_OPTIONS.map((option) => {
                                const isSelected = injury.treatments.includes(option);
                                return (
                                  <button
                                    key={option}
                                    type="button"
                                    onClick={() => {
                                      const next = isSelected
                                        ? injury.treatments.filter((t) => t !== option)
                                        : [...injury.treatments, option];
                                      updateInjuryLocal(injury.id, { treatments: next });
                                      saveInjuryField(injury.id, { treatments: next.length > 0 ? next : null });
                                    }}
                                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                                      isSelected
                                        ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                                        : "border-black/10 bg-white text-black/60 hover:bg-black/[0.02]"
                                    }`}
                                  >
                                    {option}
                                  </button>
                                );
                              })}
                            </div>
                            {injury.treatments.includes("Other") && (
                              <TextField
                                label="Other -- please specify"
                                id={`treatment-other-${injury.id}`}
                                value={injury.treatmentOther}
                                onChange={(e) => updateInjuryLocal(injury.id, { treatmentOther: e.target.value })}
                                onBlur={() => saveInjuryField(injury.id, { treatment_other: injury.treatmentOther.trim() || null })}
                                placeholder="Optional"
                                className="mt-3"
                              />
                            )}
                          </div>

                          <Textarea
                            label="Optional -- more information on the injury:"
                            id={`injury-notes-${injury.id}`}
                            value={injury.injuryNotes}
                            onChange={(e) => updateInjuryLocal(injury.id, { injuryNotes: e.target.value })}
                            onBlur={() => saveInjuryField(injury.id, { injury_notes: injury.injuryNotes.trim() || null })}
                            rows={2}
                          />
                        </div>
                      </div>
                    </div>
                  ))}

                  {anyoneInjured === true &&
                    (isAddingInjury ? (
                    <div className="rounded-2xl border border-black/5 bg-white p-4">
                      <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Who was injured?</span>
                      <p className="mb-2 text-xs text-brand-neutral-black/50">
                        Chosen from people already named on this incident -- the same person is always the same
                        record. Unlike the restrictive practice section above, staff without an account are included
                        here too: anyone can be injured, whether or not they can be held accountable for a technique.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {children.map((child) => (
                          <button
                            key={child.passportId}
                            type="button"
                            onClick={() => {
                              setNewInjuryParty({ kind: "student", passportId: child.passportId, name: child.childName });
                              setNewInjuryStaffFreeText("");
                            }}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                              newInjuryParty?.kind === "student" && newInjuryParty.passportId === child.passportId
                                ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                                : "border-black/10 bg-white text-black/60"
                            }`}
                          >
                            {child.childName}
                          </button>
                        ))}
                        {incidentStaffForPicker.map((staffMember) => (
                          <button
                            key={staffMember.key}
                            type="button"
                            onClick={() => {
                              setNewInjuryParty({
                                kind: "named_staff",
                                userId: staffMember.userId,
                                freeTextName: staffMember.freeTextName,
                                name: staffMember.name,
                              });
                              setNewInjuryStaffFreeText("");
                            }}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                              newInjuryParty?.kind === "named_staff" && newInjuryParty.userId === staffMember.userId && newInjuryParty.freeTextName === staffMember.freeTextName
                                ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                                : "border-black/10 bg-white text-black/60"
                            }`}
                          >
                            {staffMember.name}
                            {!staffMember.userId && <span className="text-black/40"> (no account)</span>}
                          </button>
                        ))}
                      </div>
                      <TextField
                        label="Someone not named on this incident (name)"
                        id="new-injury-staff-name"
                        value={newInjuryStaffFreeText}
                        onChange={(e) => {
                          setNewInjuryStaffFreeText(e.target.value);
                          setNewInjuryParty(null);
                        }}
                        placeholder="e.g. Demo Teacher"
                        className="mt-3"
                      />
                      {addInjuryError && (
                        <p role="alert" className="mt-2 text-sm font-medium text-red-600">
                          {addInjuryError}
                        </p>
                      )}
                      <div className="mt-3 flex gap-2">
                        <Button type="button" onClick={handleAddInjury}>
                          Add
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            setIsAddingInjury(false);
                            setAddInjuryError(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                    ) : (
                    <button
                      type="button"
                      onClick={() => setIsAddingInjury(true)}
                      className="rounded-2xl border-2 border-dashed border-brand-prussian-blue/30 py-3 text-sm font-semibold text-brand-prussian-blue"
                    >
                      + Add injury record
                    </button>
                    ))}
                </div>
              </section>

              <section>
                <h2 className="mb-3 font-heading text-lg font-bold text-brand-prussian-blue">Debrief</h2>

                <div className="rounded-2xl border border-black/5 bg-white p-4">
                  <div>
                    <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Debrief required?</span>
                    <PillSingleSelect
                      options={REMAINED_ON_SITE_OPTIONS}
                      value={debriefRequired ? "yes" : "no"}
                      onChange={(v) => setDebriefRequiredAndSave(v === "yes")}
                    />
                  </div>

                  {debriefRequired && (
                    <div className="mt-4 border-t border-black/[0.06] pt-4">
                      {!owningTeacherId ? (
                        <p className="rounded-xl bg-brand-off-white/60 p-3 text-sm text-brand-neutral-black/60">
                          A class teacher must claim this incident (see Actions Taken) before the debrief can be
                          started.
                        </p>
                      ) : !canEditDebrief && !debriefCompletedAt ? (
                        <p className="rounded-xl bg-brand-off-white/60 p-3 text-sm text-brand-neutral-black/60">
                          Only {owningTeacherName}, the owning teacher, can complete this debrief.
                        </p>
                      ) : (
                        <fieldset disabled={!canEditDebrief} className="flex flex-col gap-4 disabled:opacity-60">
                          <TextField
                            label="Date of debrief"
                            id="debrief-date"
                            type="date"
                            value={debriefDate}
                            onChange={(e) => setDebriefDate(e.target.value)}
                          />

                          <div>
                            <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Staff present for debrief:</span>
                            {debriefStaffPresent.length > 0 && (
                              <div className="mb-2 flex flex-wrap gap-2">
                                {debriefStaffPresent.map((name) => (
                                  <span
                                    key={name}
                                    className="flex items-center gap-1.5 rounded-full bg-brand-pastel-blue/20 px-3 py-1 text-xs font-semibold text-brand-prussian-blue"
                                  >
                                    {name}
                                    <button type="button" onClick={() => removeDebriefStaffPresent(name)} aria-label={`Remove ${name}`}>
                                      ×
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="flex gap-2">
                              <TextField
                                label="Add a name"
                                id="debrief-staff-input"
                                value={debriefStaffInput}
                                onChange={(e) => setDebriefStaffInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addDebriefStaffPresent();
                                  }
                                }}
                                className="flex-1"
                              />
                              <button
                                type="button"
                                onClick={addDebriefStaffPresent}
                                disabled={!debriefStaffInput.trim()}
                                className="mt-[1.9rem] flex-shrink-0 rounded-xl border-2 border-brand-prussian-blue px-4 py-3 text-sm font-semibold text-brand-prussian-blue disabled:opacity-40"
                              >
                                Add
                              </button>
                            </div>
                          </div>

                          <Textarea
                            label="Notes from debrief:"
                            id="debrief-notes"
                            value={debriefNotes}
                            onChange={(e) => setDebriefNotes(e.target.value)}
                            rows={3}
                          />

                          <Textarea
                            label="Actions for management/BA:"
                            id="debrief-actions"
                            value={debriefActionsForManagement}
                            onChange={(e) => setDebriefActionsForManagement(e.target.value)}
                            rows={3}
                          />

                          {debriefSaveError && (
                            <p role="alert" className="text-sm font-medium text-red-600">
                              {debriefSaveError}
                            </p>
                          )}
                          {debriefSavedAt && !debriefSaveError && !debriefCompletedAt && (
                            <p className="text-sm font-medium text-green-700">Saved.</p>
                          )}

                          {debriefCompletedAt ? (
                            <p className="rounded-xl bg-brand-pastel-blue/10 p-3 text-sm text-brand-prussian-blue">
                              Completed by {debriefCompletedByName} on {formatDateTime(debriefCompletedAt)}.
                            </p>
                          ) : (
                            canEditDebrief && (
                              <div className="flex gap-2">
                                <Button type="button" onClick={handleSaveDebrief} disabled={isSavingDebrief}>
                                  {isSavingDebrief ? "Saving…" : "Save"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={handleMarkDebriefComplete}
                                  disabled={isCompletingDebrief || !debriefId}
                                >
                                  {isCompletingDebrief ? "Completing…" : "Mark debrief complete"}
                                </Button>
                              </div>
                            )
                          )}
                        </fieldset>
                      )}
                    </div>
                  )}
                </div>
              </section>
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

            {/* Sign-off is the owning teacher's action specifically (0069:
                creator alone is not enough), not the broader canEdit used
                everywhere else on this page -- matches exactly what
                sign_off_incident() will actually allow. Nothing renders
                once locked; the isLocked banner above already covers
                that state, and countersign (below, gated on isLocked
                instead) is a separate card for a separate population. */}
            {!isLocked && owningTeacherId === user?.id && (
              <RequestAttestationsCard
                incidentId={params.incidentId as string}
                requested={attestationsRequested}
                onChange={setAttestationsRequested}
              />
            )}

            {!isLocked && owningTeacherId === user?.id && (
              <SignOffCard
                incidentId={params.incidentId as string}
                onSignedOff={() => setReloadKey((k) => k + 1)}
              />
            )}

            {/* Attestation is a DIFFERENT population from sign-off -- any
                named staff member with a real account, not just the
                owning teacher (who may also be named staff themselves,
                in which case they'd see both cards). Renders in both the
                open and closed state (unlike SignOffCard, which
                disappears once locked) -- a staff member's name is on a
                legal record and they should be able to look up what they
                attested to even after it closes. Self-hides entirely
                (returns null) if the current user isn't named on this
                incident at all. */}
            <AttestationCard incidentId={params.incidentId as string} isClosed={isLocked} ownerUserId={owningTeacherId} />
          </div>

          {/* Countersign -- Phase 4 piece 3. Only meaningful once
              teacher-signed (isLocked); self-hides entirely for
              anyone get_countersign_summary() refuses, so no separate
              "am I a countersigner" check is needed here. Full record
              is already rendered read-only in the report column for
              anyone who can see this page at all -- this card adds
              what the teacher's own form doesn't show: who attested,
              who didn't, addenda in full, withdrawals with their
              reason.
              PRD 4, Stage 3 -- the sticky action panel itself. Only
              exists in the tree at all when isLocked (matching the
              CountersignCard gate one line down, and the left column's
              own isLocked check above) -- an unlocked incident renders
              no second child here, so the outer flex-col above has
              nothing extra to add spacing around. */}
          {isLocked && (
            <div className="lg:col-span-4 lg:sticky lg:top-6">
              {user && (
                <CountersignCard
                  incidentId={params.incidentId as string}
                  userId={user.id}
                  onCountersigned={() => setReloadKey((k) => k + 1)}
                />
              )}
            </div>
          )}
          </div>
        ) : null}
      </main>
    </div>
  );
}
