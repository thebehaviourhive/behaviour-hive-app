import { createClient } from "@/lib/supabase/client";

// PRD 8 Stage 2 -- the read composition for both directions of clinical
// export. Every fetch here goes through a table's own already-RLS-scoped
// read (a raw select an author/domain-colleague could already run
// themselves) or one of the five new director-read RPCs (0247, 0248) --
// never a single function re-deriving authorization for many tables at
// once. Someone will eventually look at eight separate queries in this
// file and think a single RPC would be tidier. It would not: a single
// SECURITY DEFINER function holding the correct answer for eight tables
// means one mistake in it leaks everything at once. This file inherits
// every access guarantee already proven for each table individually,
// including the live-relationship rule and the incident withhold gate
// (0245) -- a school export that reused a single broad function would
// have to re-derive "is this incident withheld" itself, and get it
// right, rather than simply never being able to see a withheld incident
// in the first place because the RPC it calls already excludes it.
//
// THE TIME-SCOPED JOIN. "Ownership follows authorship, permanently"
// (PRD 8 section 2) only holds if a clinician's own material is
// attributed to whichever clinic they belonged to WHEN they wrote it,
// not whichever clinic they belong to today. institution_staff has no
// uniqueness across time -- a clinician who moved from Clinic A to
// Clinic B has two rows, one historical. Every filter in this file that
// narrows something down to "this clinic's own clinicians" is anchored
// to the artefact's own created_at, via the same client-side mirror of
// _clinician_authored_at_institution() (0246) -- the RPCs already do
// this server-side for the tables that have a director branch; the
// tables that don't (passport_clinical_content's own raw RLS read,
// abc_logs via get_abc_logs()) return more than belongs in THIS export
// (a clinician_access grant on passport_clinical_content isn't
// institution-scoped at all; get_abc_logs()'s principal branch returns
// every audience's entries, not just this clinic's own), so this file
// re-applies the same time-scoped test client-side to those two.

export interface ClinicianTenure {
  clinicianId: string;
  approvedAt: string;
  deactivatedAt: string | null;
}

// Mirrors _clinician_authored_at_institution() exactly -- same
// inclusive-start, exclusive-end tenure window.
function authoredWhileAtInstitution(tenures: ClinicianTenure[], clinicianId: string, at: string): boolean {
  const atTime = new Date(at).getTime();
  return tenures.some((t) => {
    if (t.clinicianId !== clinicianId) return false;
    const approvedTime = new Date(t.approvedAt).getTime();
    if (approvedTime > atTime) return false;
    if (t.deactivatedAt && new Date(t.deactivatedAt).getTime() <= atTime) return false;
    return true;
  });
}

export interface ExportFbaReport {
  id: string;
  status: string;
  contentData: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
  clinicianName: string | null;
}

export interface ExportBsp {
  id: string;
  status: string;
  targetBehaviours: unknown[];
  triggers: unknown[];
  settingEvents: unknown[];
  precursors: string | null;
  currentFrequency: string | null;
  signedAt: string | null;
  createdAt: string;
  clinicianName: string | null;
}

export interface ExportClinicalPlan {
  id: string;
  planType: string;
  name: string;
  planDate: string;
  body: string | null;
  createdAt: string;
  clinicianName: string | null;
}

export interface ExportAssessment {
  id: string;
  recordType: string;
  assessmentDate: string;
  completedAt: string | null;
  respondentType: string | null;
  responses: Record<string, unknown> | null;
  subscaleTotals: unknown[] | null;
  instrumentVersion: string | null;
  administratorName: string | null;
  location: string | null;
  scores: unknown[] | null;
  interpretation: string | null;
  createdAt: string;
  clinicianName: string | null;
  instrumentName: string | null;
}

export interface ExportSessionNote {
  id: string;
  sessionDate: string;
  clinicalRecord: string | null;
  createdAt: string;
  clinicianName: string | null;
}

export interface ExportClinicalContentItem {
  id: string;
  itemType: string;
  content: Record<string, unknown>;
  authorId: string;
  authorName: string | null;
  sourceDocumentType: string;
  createdAt: string;
}

export interface ExportAbcLog {
  id: string;
  incidentDate: string;
  incidentTime: string;
  loggedByRole: string;
  loggedByName: string | null;
}

export interface ExportIncident {
  incidentId: string;
  occurredAt: string;
  category: string | null;
  narrative: string | null;
  anyoneInjured: boolean | null;
  status: string;
  countersignedAt: string | null;
}

export interface ExportAttachmentRef {
  artefactType: "assessment" | "clinical_plan";
  artefactId: string;
  storagePath: string;
  originalFilename: string;
  contentType: string;
}

export interface ClinicExportData {
  fbaReports: ExportFbaReport[];
  bsps: ExportBsp[];
  clinicalPlans: ExportClinicalPlan[];
  assessments: ExportAssessment[];
  sessionNotes: ExportSessionNote[];
  clinicalContent: ExportClinicalContentItem[];
  abcLogs: ExportAbcLog[];
  attachments: ExportAttachmentRef[];
}

export interface SchoolExportData {
  incidents: ExportIncident[];
  abcLogs: ExportAbcLog[];
  clinicalContent: ExportClinicalContentItem[];
}

async function fetchClinicianTenures(institutionId: string): Promise<ClinicianTenure[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("institution_staff")
    .select("user_id, approved_at, deactivated_at")
    .eq("institution_id", institutionId)
    .eq("role", "clinician")
    .not("approved_at", "is", null);
  return (data ?? []).map((r) => ({ clinicianId: r.user_id, approvedAt: r.approved_at, deactivatedAt: r.deactivated_at }));
}

/** The director's own export: everything the clinic's own clinicians
 *  authored, via the five new director-read RPCs, plus the two tables
 *  filtered client-side against the time-scoped tenure window. */
export async function fetchClinicExportDataForDirector(passportId: string, institutionId: string): Promise<ClinicExportData> {
  const supabase = createClient();
  const [fbaRes, bspRes, planRes, assessRes, noteRes, contentRes, abcRes, instrumentsRes] = await Promise.all([
    supabase.rpc("get_fba_reports_for_director", { p_passport_id: passportId }),
    supabase.rpc("get_bsp_for_director", { p_passport_id: passportId }),
    supabase.rpc("get_clinical_plans_for_director", { p_passport_id: passportId }),
    supabase.rpc("get_assessments_for_director", { p_passport_id: passportId }),
    supabase.rpc("get_session_notes_for_director", { p_passport_id: passportId }),
    supabase.rpc("get_passport_clinical_content_for_director", { p_passport_id: passportId }),
    supabase.rpc("get_abc_logs", { p_passport_id: passportId }),
    supabase.from("assessment_instruments").select("id, name"),
  ]);

  const tenures = await fetchClinicianTenures(institutionId);
  const instrumentNames = new Map((instrumentsRes.data ?? []).map((i: { id: string; name: string }) => [i.id, i.name]));

  const abcLogs = ((abcRes.data ?? []) as Array<{ id: string; incident_date: string; incident_time: string; logged_by_role: string; logged_by: string; logged_by_name: string | null }>)
    .filter((a) => a.logged_by_role === "clinician" && authoredWhileAtInstitution(tenures, a.logged_by, a.incident_date))
    .map((a) => ({ id: a.id, incidentDate: a.incident_date, incidentTime: a.incident_time, loggedByRole: a.logged_by_role, loggedByName: a.logged_by_name }));

  const clinicalContent = ((contentRes.data ?? []) as Array<{ id: string; item_type: string; content: Record<string, unknown>; author_id: string; author_name: string | null; source_document_type: string; created_at: string }>)
    .map((c) => ({ id: c.id, itemType: c.item_type, content: c.content, authorId: c.author_id, authorName: c.author_name, sourceDocumentType: c.source_document_type, createdAt: c.created_at }));

  const assessRows = (assessRes.data ?? []) as Array<{
    id: string; record_type: string; assessment_date: string; completed_at: string | null; respondent_type: string | null;
    responses: Record<string, unknown> | null; subscale_totals: unknown[] | null; instrument_version: string | null;
    administrator_name: string | null; location: string | null; scores: unknown[] | null; interpretation: string | null;
    created_at: string; clinician_name: string | null; instrument_id: string;
  }>;
  const assessments: ExportAssessment[] = assessRows.map((a) => ({
    id: a.id, recordType: a.record_type, assessmentDate: a.assessment_date, completedAt: a.completed_at,
    respondentType: a.respondent_type, responses: a.responses, subscaleTotals: a.subscale_totals,
    instrumentVersion: a.instrument_version, administratorName: a.administrator_name, location: a.location,
    scores: a.scores, interpretation: a.interpretation, createdAt: a.created_at, clinicianName: a.clinician_name,
    instrumentName: instrumentNames.get(a.instrument_id) ?? null,
  }));

  const { data: planAttachments } = await supabase
    .from("attachments")
    .select("artefact_type, artefact_id, storage_path, original_filename, content_type")
    .eq("artefact_type", "clinical_plan")
    .in("artefact_id", ((planRes.data ?? []) as Array<{ id: string }>).map((p) => p.id).length > 0 ? ((planRes.data ?? []) as Array<{ id: string }>).map((p) => p.id) : ["00000000-0000-0000-0000-000000000000"]);
  const { data: assessAttachments } = await supabase
    .from("attachments")
    .select("artefact_type, artefact_id, storage_path, original_filename, content_type")
    .eq("artefact_type", "assessment")
    .in("artefact_id", assessments.map((a) => a.id).length > 0 ? assessments.map((a) => a.id) : ["00000000-0000-0000-0000-000000000000"]);

  const attachments: ExportAttachmentRef[] = [...(planAttachments ?? []), ...(assessAttachments ?? [])].map((a) => ({
    artefactType: a.artefact_type, artefactId: a.artefact_id, storagePath: a.storage_path,
    originalFilename: a.original_filename, contentType: a.content_type,
  }));

  return {
    fbaReports: ((fbaRes.data ?? []) as Array<{ id: string; status: string; content_data: Record<string, unknown>; created_at: string; completed_at: string | null; clinician_name: string | null }>)
      .map((f) => ({ id: f.id, status: f.status, contentData: f.content_data, createdAt: f.created_at, completedAt: f.completed_at, clinicianName: f.clinician_name })),
    bsps: ((bspRes.data ?? []) as Array<{ id: string; status: string; target_behaviours: unknown[]; triggers: unknown[]; setting_events: unknown[]; precursors: string | null; current_frequency: string | null; signed_at: string | null; created_at: string; clinician_name: string | null }>)
      .map((b) => ({ id: b.id, status: b.status, targetBehaviours: b.target_behaviours, triggers: b.triggers, settingEvents: b.setting_events, precursors: b.precursors, currentFrequency: b.current_frequency, signedAt: b.signed_at, createdAt: b.created_at, clinicianName: b.clinician_name })),
    clinicalPlans: ((planRes.data ?? []) as Array<{ id: string; plan_type: string; name: string; plan_date: string; body: string | null; created_at: string; clinician_name: string | null }>)
      .map((p) => ({ id: p.id, planType: p.plan_type, name: p.name, planDate: p.plan_date, body: p.body, createdAt: p.created_at, clinicianName: p.clinician_name })),
    assessments,
    sessionNotes: ((noteRes.data ?? []) as Array<{ id: string; session_date: string; clinical_record: string | null; created_at?: string; clinician_name: string | null }>)
      .map((n) => ({ id: n.id, sessionDate: n.session_date, clinicalRecord: n.clinical_record, createdAt: n.session_date, clinicianName: n.clinician_name })),
    clinicalContent,
    abcLogs,
    attachments,
  };
}

/** A practitioner's own export -- their own authored material only,
 *  every table's ordinary author-scoped read (no director RPC needed;
 *  an author reading their own row is already the base case every one
 *  of these RLS policies grants). */
export async function fetchClinicExportDataForPractitioner(passportId: string, clinicianId: string): Promise<ClinicExportData> {
  const supabase = createClient();
  const [fbaRes, bspRes, planRes, assessRes, noteRes, contentRes, abcRes, instrumentsRes] = await Promise.all([
    supabase.from("fba_reports").select("id, status, content_data, created_at, completed_at").eq("passport_id", passportId).eq("clinician_id", clinicianId),
    supabase.from("bsp").select("id, status, target_behaviours, triggers, setting_events, precursors, current_frequency, signed_at, created_at").eq("passport_id", passportId).eq("clinician_id", clinicianId),
    supabase.from("clinical_plans").select("id, plan_type, name, plan_date, body, created_at").eq("passport_id", passportId).eq("clinician_id", clinicianId),
    supabase.from("assessments").select("id, record_type, assessment_date, completed_at, respondent_type, responses, subscale_totals, instrument_version, administrator_name, location, scores, interpretation, created_at, instrument_id").eq("passport_id", passportId).eq("clinician_id", clinicianId),
    supabase.from("session_notes").select("id, session_date, clinical_record, created_at").eq("passport_id", passportId).eq("clinician_id", clinicianId),
    supabase.from("passport_clinical_content").select("id, item_type, content, author_id, source_document_type, created_at").eq("passport_id", passportId).eq("author_id", clinicianId),
    supabase.rpc("get_abc_logs", { p_passport_id: passportId }),
    supabase.from("assessment_instruments").select("id, name"),
  ]);

  const instrumentNames = new Map((instrumentsRes.data ?? []).map((i: { id: string; name: string }) => [i.id, i.name]));

  const abcLogs = ((abcRes.data ?? []) as Array<{ id: string; incident_date: string; incident_time: string; logged_by_role: string; logged_by: string; logged_by_name: string | null }>)
    .filter((a) => a.logged_by_role === "clinician" && a.logged_by === clinicianId)
    .map((a) => ({ id: a.id, incidentDate: a.incident_date, incidentTime: a.incident_time, loggedByRole: a.logged_by_role, loggedByName: a.logged_by_name }));

  const assessRows = (assessRes.data ?? []) as Array<{
    id: string; record_type: string; assessment_date: string; completed_at: string | null; respondent_type: string | null;
    responses: Record<string, unknown> | null; subscale_totals: unknown[] | null; instrument_version: string | null;
    administrator_name: string | null; location: string | null; scores: unknown[] | null; interpretation: string | null;
    created_at: string; instrument_id: string;
  }>;
  const assessments: ExportAssessment[] = assessRows.map((a) => ({
    id: a.id, recordType: a.record_type, assessmentDate: a.assessment_date, completedAt: a.completed_at,
    respondentType: a.respondent_type, responses: a.responses, subscaleTotals: a.subscale_totals,
    instrumentVersion: a.instrument_version, administratorName: a.administrator_name, location: a.location,
    scores: a.scores, interpretation: a.interpretation, createdAt: a.created_at, clinicianName: null,
    instrumentName: instrumentNames.get(a.instrument_id) ?? null,
  }));

  const planIds = ((planRes.data ?? []) as Array<{ id: string }>).map((p) => p.id);
  const assessIds = assessments.map((a) => a.id);
  const { data: planAttachments } = await supabase
    .from("attachments").select("artefact_type, artefact_id, storage_path, original_filename, content_type")
    .eq("artefact_type", "clinical_plan").in("artefact_id", planIds.length > 0 ? planIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: assessAttachments } = await supabase
    .from("attachments").select("artefact_type, artefact_id, storage_path, original_filename, content_type")
    .eq("artefact_type", "assessment").in("artefact_id", assessIds.length > 0 ? assessIds : ["00000000-0000-0000-0000-000000000000"]);

  const attachments: ExportAttachmentRef[] = [...(planAttachments ?? []), ...(assessAttachments ?? [])].map((a) => ({
    artefactType: a.artefact_type, artefactId: a.artefact_id, storagePath: a.storage_path,
    originalFilename: a.original_filename, contentType: a.content_type,
  }));

  return {
    fbaReports: ((fbaRes.data ?? []) as Array<{ id: string; status: string; content_data: Record<string, unknown>; created_at: string; completed_at: string | null }>)
      .map((f) => ({ id: f.id, status: f.status, contentData: f.content_data, createdAt: f.created_at, completedAt: f.completed_at, clinicianName: null })),
    bsps: ((bspRes.data ?? []) as Array<{ id: string; status: string; target_behaviours: unknown[]; triggers: unknown[]; setting_events: unknown[]; precursors: string | null; current_frequency: string | null; signed_at: string | null; created_at: string }>)
      .map((b) => ({ id: b.id, status: b.status, targetBehaviours: b.target_behaviours, triggers: b.triggers, settingEvents: b.setting_events, precursors: b.precursors, currentFrequency: b.current_frequency, signedAt: b.signed_at, createdAt: b.created_at, clinicianName: null })),
    clinicalPlans: ((planRes.data ?? []) as Array<{ id: string; plan_type: string; name: string; plan_date: string; body: string | null; created_at: string }>)
      .map((p) => ({ id: p.id, planType: p.plan_type, name: p.name, planDate: p.plan_date, body: p.body, createdAt: p.created_at, clinicianName: null })),
    assessments,
    sessionNotes: ((noteRes.data ?? []) as Array<{ id: string; session_date: string; clinical_record: string | null; created_at: string }>)
      .map((n) => ({ id: n.id, sessionDate: n.session_date, clinicalRecord: n.clinical_record, createdAt: n.created_at, clinicianName: null })),
    clinicalContent: ((contentRes.data ?? []) as Array<{ id: string; item_type: string; content: Record<string, unknown>; author_id: string; source_document_type: string; created_at: string }>)
      .map((c) => ({ id: c.id, itemType: c.item_type, content: c.content, authorId: c.author_id, authorName: null, sourceDocumentType: c.source_document_type, createdAt: c.created_at })),
    abcLogs,
    attachments,
  };
}

/** The school's own export: institution-wide, via the same reads a
 *  principal's own ordinary pages already use -- get_child_incidents_
 *  for_staff() (has_child_access-gated, already excludes any incident
 *  withheld from a clinic -- irrelevant here, that gate is about the
 *  OTHER direction, but confirms this RPC has no reason to omit
 *  anything a school itself authored), get_abc_logs() filtered to
 *  school-authored rows, get_passport_clinical_content() (its own
 *  principal branch already applies the exact item_type filter --
 *  strategy_school/strategy_shared/trigger/setting_event -- that
 *  defines "published guidance" for a school; strategy_home structurally
 *  cannot appear, the same boundary passport_access-scoped teachers
 *  already get). */
export async function fetchSchoolExportData(passportId: string): Promise<SchoolExportData> {
  const supabase = createClient();
  const [incidentRes, abcRes, contentRes] = await Promise.all([
    supabase.rpc("get_child_incidents_for_staff", { p_passport_id: passportId }),
    supabase.rpc("get_abc_logs", { p_passport_id: passportId }),
    supabase.rpc("get_passport_clinical_content", { p_passport_id: passportId }),
  ]);

  const abcLogs = ((abcRes.data ?? []) as Array<{ id: string; incident_date: string; incident_time: string; logged_by_role: string; logged_by_name: string | null }>)
    .filter((a) => a.logged_by_role === "class_teacher" || a.logged_by_role === "sna")
    .map((a) => ({ id: a.id, incidentDate: a.incident_date, incidentTime: a.incident_time, loggedByRole: a.logged_by_role, loggedByName: a.logged_by_name }));

  return {
    incidents: ((incidentRes.data ?? []) as Array<{ incident_id: string; occurred_at: string; category: string | null; narrative: string | null; anyone_injured: boolean | null; status: string; countersigned_at: string | null }>)
      .map((i) => ({ incidentId: i.incident_id, occurredAt: i.occurred_at, category: i.category, narrative: i.narrative, anyoneInjured: i.anyone_injured, status: i.status, countersignedAt: i.countersigned_at })),
    abcLogs,
    clinicalContent: ((contentRes.data ?? []) as Array<{ id: string; item_type: string; content: Record<string, unknown>; author_id: string; author_name: string | null; source_document_type: string; created_at: string }>)
      .map((c) => ({ id: c.id, itemType: c.item_type, content: c.content, authorId: c.author_id, authorName: c.author_name, sourceDocumentType: c.source_document_type, createdAt: c.created_at })),
  };
}
