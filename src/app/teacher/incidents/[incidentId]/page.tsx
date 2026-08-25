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
import { BodyMapCard, type InjuryTypeOption } from "@/components/incident-log/body-map/BodyMapCard";

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
  staffInitials: string;
  ncseReportComplete: boolean;
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
    ncseReportComplete: false,
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
  firstAiderCalled: boolean;
  firstAiderName: string;
  doctorAmbulanceCalled: boolean;
  remainedOnSite: boolean | null;
  remainedDetail: string;
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

  const [actionTypes, setActionTypes] = useState<ActionType[]>([]);
  const [selectedActionTypeIds, setSelectedActionTypeIds] = useState<string[]>([]);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const [cpiReasonOptions, setCpiReasonOptions] = useState<string[]>([]);
  const [cpiDisengagementOptions, setCpiDisengagementOptions] = useState<string[]>([]);
  const [cpiResultOptions, setCpiResultOptions] = useState<string[]>([]);
  // Keyed by passport_id -- a restrictive-practice record belongs to one
  // named child, not the incident as a whole (0068 Part 7).
  const [restrictivePracticesByChild, setRestrictivePracticesByChild] = useState<Record<string, RestrictivePracticeRecord[]>>({});

  const [injuryTypeOptions, setInjuryTypeOptions] = useState<InjuryTypeOption[]>([]);
  const [injuries, setInjuries] = useState<InjuryRecordState[]>([]);
  const [isAddingInjury, setIsAddingInjury] = useState(false);
  const [newInjuryParty, setNewInjuryParty] = useState<{ type: "student"; passportId: string; name: string } | null>(null);
  const [newInjuryStaffName, setNewInjuryStaffName] = useState("");
  const [addInjuryError, setAddInjuryError] = useState<string | null>(null);

  const [owningTeacherId, setOwningTeacherId] = useState<string | null>(null);
  const [owningTeacherName, setOwningTeacherName] = useState<string | null>(null);
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
          "institution_id, created_by, owning_teacher_id, teacher_signed_at, occurred_at, incident_locations(value), category, party, item_involved, narrative, parent_summary, staff_count_needed, staff_distressed, risk_reduction_future, other_information, debrief_required"
        )
        .eq("id", params.incidentId)
        .maybeSingle();

      if (!isMounted) return;

      if (incidentError || !incident) {
        setError("Could not find this incident.");
        setIsLoading(false);
        return;
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
        { data: injuryRows },
        { data: debriefRow },
      ] = await Promise.all([
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
        supabase.from("incident_recovery_types").select("value").or(institutionOrGlobal).eq("is_active", true).order("sort_order"),
        supabase
          .from("incident_action_types")
          .select("id, value, is_restraint")
          .or(institutionOrGlobal)
          .eq("is_active", true)
          .order("sort_order"),
        supabase.from("incident_actions").select("action_type_id").eq("incident_id", params.incidentId),
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
        supabase
          .from("incident_injuries")
          .select(
            "id, injured_party_type, passport_id, staff_user_id, free_text_name, injury_types, injury_notes, first_aider_called, first_aider_name, doctor_ambulance_called, remained_on_site, remained_detail"
          )
          .eq("incident_id", params.incidentId)
          .order("created_at", { ascending: true }),
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

      setActionTypes(
        (actionTypeRows ?? []).map((row) => ({ id: row.id, value: row.value, isRestraint: row.is_restraint }))
      );
      setSelectedActionTypeIds((selectedActionRows ?? []).map((row) => row.action_type_id));
      setCpiReasonOptions((reasonTypes ?? []).map((row) => row.value));
      setCpiDisengagementOptions((disengagementTypes ?? []).map((row) => row.value));
      setCpiResultOptions((resultTypes ?? []).map((row) => row.value));

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
          ncseReportComplete: row.ncse_report_complete,
          isSaving: false,
          saveError: null,
          savedAt: null,
        };
        byChild[row.passport_id] = [...(byChild[row.passport_id] ?? []), record];
      }
      setRestrictivePracticesByChild(byChild);

      setInjuryTypeOptions((injuryTypeRows ?? []).map((row) => ({ id: row.id, value: row.value })));
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
          remainedOnSite: row.remained_on_site,
          remainedDetail: row.remained_detail ?? "",
        }))
      );

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

      // The debrief is owning-teacher-only, not creator-or-owning-teacher
      // -- matches incident_debriefs' own RLS exactly
      // ("i.owning_teacher_id = auth.uid()", no created_by branch at
      // all), not the broader canEdit used everywhere else on this page.
      setOwningTeacherId(incident.owning_teacher_id);
      setOwningTeacherName(incident.owning_teacher_id ? nameByUserId.get(incident.owning_teacher_id) ?? "the owning teacher" : null);
      setCanEditDebrief(!incident.teacher_signed_at && incident.owning_teacher_id === user!.id);

      setDebriefRequired(incident.debrief_required);
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

    if (record.id) {
      const { error: updateError } = await supabase.from("restrictive_practices").update(payload).eq("id", record.id);
      if (updateError) {
        updateRestrictivePracticeRecord(passportId, index, { isSaving: false, saveError: updateError.message });
        return;
      }
      updateRestrictivePracticeRecord(passportId, index, { isSaving: false, savedAt: Date.now() });
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
      updateRestrictivePracticeRecord(passportId, index, { isSaving: false, savedAt: Date.now(), id: inserted.id });
    }
  }

  async function handleAddInjury() {
    setAddInjuryError(null);
    if (!newInjuryParty && !newInjuryStaffName.trim()) {
      setAddInjuryError("Choose who this injury record is for.");
      return;
    }

    const supabase = createClient();
    const payload: Record<string, unknown> = newInjuryParty
      ? { incident_id: params.incidentId as string, injured_party_type: "student", passport_id: newInjuryParty.passportId }
      : { incident_id: params.incidentId as string, injured_party_type: "staff", free_text_name: newInjuryStaffName.trim() };

    const { data: inserted, error: insertError } = await supabase.from("incident_injuries").insert(payload).select("id").single();

    if (insertError) {
      setAddInjuryError(insertError.message);
      return;
    }

    setInjuries((current) => [
      ...current,
      {
        id: inserted.id,
        injuredPartyType: newInjuryParty ? "student" : "staff",
        passportId: newInjuryParty?.passportId ?? null,
        staffUserId: null,
        partyName: newInjuryParty?.name ?? newInjuryStaffName.trim(),
        injuryTypes: [],
        injuryNotes: "",
        firstAiderCalled: false,
        firstAiderName: "",
        doctorAmbulanceCalled: false,
        remainedOnSite: null,
        remainedDetail: "",
      },
    ]);
    setIsAddingInjury(false);
    setNewInjuryParty(null);
    setNewInjuryStaffName("");
  }

  function updateInjuryLocal(injuryId: string, patch: Partial<InjuryRecordState>) {
    setInjuries((current) => current.map((inj) => (inj.id === injuryId ? { ...inj, ...patch } : inj)));
  }

  async function saveInjuryField(injuryId: string, patch: Record<string, unknown>) {
    const supabase = createClient();
    await supabase.from("incident_injuries").update(patch).eq("id", injuryId);
  }

  function toggleInjuryType(injuryId: string, typeValue: string) {
    const injury = injuries.find((inj) => inj.id === injuryId);
    if (!injury) return;
    const has = injury.injuryTypes.includes(typeValue);
    const next = has ? injury.injuryTypes.filter((t) => t !== typeValue) : [...injury.injuryTypes, typeValue];
    updateInjuryLocal(injuryId, { injuryTypes: next });
    saveInjuryField(injuryId, { injury_types: next.length > 0 ? next : null });
  }

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
  const hasCpiSelected = selectedActionTypeIds.some(
    (id) => actionTypes.find((a) => a.id === id)?.isRestraint
  );

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

              <section>
                <h2 className="mb-3 font-heading text-lg font-bold text-brand-prussian-blue">Actions Taken</h2>
                <div className="rounded-2xl border border-black/5 bg-white p-4">
                  <div className="flex flex-wrap gap-2">
                    {actionTypes.map((action) => {
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
                </div>
              </section>

              {hasCpiSelected &&
                children.map((child) => {
                  const records = restrictivePracticesByChild[child.passportId] ?? [];
                  return (
                    <section key={`rp-${child.id}`}>
                      <h2 className="mb-3 font-heading text-lg font-bold text-brand-prussian-blue">
                        {child.childName} -- Restrictive Practice
                      </h2>

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
                                <PillSingleSelect
                                  options={HOLD_LEVEL_OPTIONS}
                                  value={record.holdLevel}
                                  onChange={(v) => updateRestrictivePracticeRecord(child.passportId, index, { holdLevel: v })}
                                />
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
                                label="Total procedures"
                                id={`total-procedures-${child.id}-${index}`}
                                type="number"
                                min={0}
                                value={record.totalProcedures}
                                onChange={(e) =>
                                  updateRestrictivePracticeRecord(child.passportId, index, { totalProcedures: e.target.value })
                                }
                              />

                              <TextField
                                label="Staff initials"
                                id={`staff-initials-${child.id}-${index}`}
                                value={record.staffInitials}
                                onChange={(e) =>
                                  updateRestrictivePracticeRecord(child.passportId, index, { staffInitials: e.target.value })
                                }
                              />

                              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-brand-neutral-black">
                                <input
                                  type="checkbox"
                                  checked={record.ncseReportComplete}
                                  onChange={(e) =>
                                    updateRestrictivePracticeRecord(child.passportId, index, { ncseReportComplete: e.target.checked })
                                  }
                                />
                                NCSE report complete
                              </label>

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

                        <button
                          type="button"
                          onClick={() => addRestrictivePracticeRecord(child.passportId)}
                          className="rounded-2xl border-2 border-dashed border-brand-prussian-blue/30 py-3 text-sm font-semibold text-brand-prussian-blue"
                        >
                          + Add a restrictive practice record
                        </button>
                      </div>
                    </section>
                  );
                })}

              <section>
                <h2 className="mb-3 font-heading text-lg font-bold text-brand-prussian-blue">Injuries</h2>

                <div className="flex flex-col gap-4">
                  {injuries.map((injury) => (
                    <div key={injury.id} className="flex flex-col gap-4">
                      <div className="rounded-2xl border border-black/5 bg-white p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="font-heading text-base font-bold text-brand-prussian-blue">{injury.partyName}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveInjury(injury.id)}
                            className="text-xs font-semibold text-brand-golden-brown"
                          >
                            Remove record
                          </button>
                        </div>

                        <div className="flex flex-col gap-4">
                          <div>
                            <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Injury type</span>
                            <PillMultiSelect
                              options={injuryTypeOptions.map((t) => ({ value: t.value }))}
                              selected={injury.injuryTypes}
                              onToggle={(v) => toggleInjuryType(injury.id, v)}
                            />
                          </div>

                          <Textarea
                            label="Notes"
                            id={`injury-notes-${injury.id}`}
                            value={injury.injuryNotes}
                            onChange={(e) => updateInjuryLocal(injury.id, { injuryNotes: e.target.value })}
                            onBlur={() => saveInjuryField(injury.id, { injury_notes: injury.injuryNotes.trim() || null })}
                            rows={2}
                          />

                          <label className="flex items-center gap-2 text-sm font-semibold text-brand-neutral-black">
                            <input
                              type="checkbox"
                              checked={injury.firstAiderCalled}
                              onChange={(e) => {
                                updateInjuryLocal(injury.id, { firstAiderCalled: e.target.checked });
                                saveInjuryField(injury.id, { first_aider_called: e.target.checked });
                              }}
                            />
                            First aider called
                          </label>

                          {injury.firstAiderCalled && (
                            <TextField
                              label="First aider name"
                              id={`first-aider-name-${injury.id}`}
                              value={injury.firstAiderName}
                              onChange={(e) => updateInjuryLocal(injury.id, { firstAiderName: e.target.value })}
                              onBlur={() => saveInjuryField(injury.id, { first_aider_name: injury.firstAiderName.trim() || null })}
                            />
                          )}

                          <label className="flex items-center gap-2 text-sm font-semibold text-brand-neutral-black">
                            <input
                              type="checkbox"
                              checked={injury.doctorAmbulanceCalled}
                              onChange={(e) => {
                                updateInjuryLocal(injury.id, { doctorAmbulanceCalled: e.target.checked });
                                saveInjuryField(injury.id, { doctor_ambulance_called: e.target.checked });
                              }}
                            />
                            Doctor / ambulance called
                          </label>

                          <div>
                            <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Remained on site</span>
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
                        </div>
                      </div>

                      <BodyMapCard
                        injuryId={injury.id}
                        partyName={injury.partyName}
                        canEdit={canEdit}
                        injuryTypeOptions={injuryTypeOptions}
                      />
                    </div>
                  ))}

                  {isAddingInjury ? (
                    <div className="rounded-2xl border border-black/5 bg-white p-4">
                      <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Who was injured?</span>
                      <div className="flex flex-wrap gap-2">
                        {children.map((child) => (
                          <button
                            key={child.passportId}
                            type="button"
                            onClick={() => {
                              setNewInjuryParty({ type: "student", passportId: child.passportId, name: child.childName });
                              setNewInjuryStaffName("");
                            }}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                              newInjuryParty?.passportId === child.passportId
                                ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                                : "border-black/10 bg-white text-black/60"
                            }`}
                          >
                            {child.childName}
                          </button>
                        ))}
                      </div>
                      <TextField
                        label="Or a staff member (name)"
                        id="new-injury-staff-name"
                        value={newInjuryStaffName}
                        onChange={(e) => {
                          setNewInjuryStaffName(e.target.value);
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
                  )}
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
                            <span className="mb-2 block text-sm font-semibold text-brand-neutral-black">Staff present</span>
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
                            label="Notes"
                            id="debrief-notes"
                            value={debriefNotes}
                            onChange={(e) => setDebriefNotes(e.target.value)}
                            rows={3}
                          />

                          <Textarea
                            label="Actions for management / BA"
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

            <p className="text-sm leading-relaxed text-brand-neutral-black/60">
              Teacher sign-off and principal countersign are not yet available in this build. This record is saved
              and will not be lost.
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
