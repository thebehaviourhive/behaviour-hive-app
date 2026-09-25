// Outstanding-task snoozing, 25 Sept 2026. The canonical list of
// queue_key values every snoozable bucket in the product uses --
// deliberately NOT a database CHECK constraint (see migration 0308's
// own header for why: a fixed enumeration would need editing every
// time a new bucket is added, for a value the schema itself never
// branches on).
//
// A full inventory pass (background research agent, before any of
// this was designed) found 31 real outstanding-task rows across 7
// roles and 8 surfaces. Several buckets DELIBERATELY do not appear
// below -- their exclusion is a decision, not an oversight, and each
// reason is recorded here so it survives past this session:
//
//  - "My Requests" sections (MyTagChangeRequestsSection, on clinical-
//    lead/clinic-admin/clinician dashboards) -- the REQUESTER's own
//    status tracking of something someone ELSE needs to act on, not an
//    outstanding task for the viewer. Navigation-only, no onAction, no
//    exception text describing a decision to make. Nothing to snooze.
//  - care/dashboard's "Active for you" -- a roster (navigation to a
//    record), not an outstanding-task list; no exception/action per
//    row.
//  - clinic-admin's "Data Sharing" list -- a status readout, not an
//    actionable queue, same shape as "My Requests" above.
//  - ClinicDirectorDashboard's own "Caseload" section -- explicitly,
//    permanently non-actionable by design (that component's own header
//    comment: "reference only, never outstanding work... never a
//    ranking").
//  - teacher/dashboard's EOD-bulk-updates row and cover-expiring-today
//    row -- both inherently same-day, time-boxed tasks. Snoozing
//    "today's EOD update" for 5 days doesn't correspond to anything
//    real: tomorrow is a genuinely NEW task, not the same item
//    reappearing, and neither bucket is keyed on a single stable
//    item_id to begin with (EOD-bulk is a multi-passport aggregate;
//    cover-expiring-today resolves itself by definition at end of day
//    regardless of any snooze).
//  - AttestationPromptCard (principal/dashboard, sna/passports) -- a
//    single collapsed count card ("You're named on N records"), not a
//    row-per-item list; there is no single item_id to snooze. The
//    IDENTICAL underlying data (incident_staff.id rows a person is
//    named on) already gets full per-row snoozing wherever it's
//    actually rendered as a list -- teacher/dashboard's own
//    "attestation_owed" bucket below. sna/passports has no row-per-
//    item outstanding-task list of its own at all today -- a real,
//    named finding from the inventory pass, not something this build
//    invented a list for just to have something to snooze.
export const OUTSTANDING_TASK_QUEUES = {
  // Principal (school) -- principal/dashboard/page.tsx
  PRINCIPAL_PARENT_CALL: "principal_parent_call",
  PRINCIPAL_WITHDRAWN_ATTESTATION: "principal_withdrawn_attestation",
  PRINCIPAL_INHERITED_INCIDENT: "principal_inherited_incident",
  PRINCIPAL_SUPPORT_ALERT: "principal_support_alert",
  PRINCIPAL_AWAITING_COUNTERSIGN: "principal_awaiting_countersign",
  PRINCIPAL_UNASSIGNED_CHILD: "principal_unassigned_child",
  PRINCIPAL_PASSPORT_COMPLETION: "principal_passport_completion",
  PRINCIPAL_DEBRIEF_OUTSTANDING: "principal_debrief_outstanding",
  PRINCIPAL_SIGNED_OFF_OUTSTANDING_ATTESTATIONS: "principal_signed_off_outstanding_attestations",
  PRINCIPAL_DECLINED_PARENT_CALL: "principal_declined_parent_call",

  // Shared across every institution-leader dashboard that has this
  // exact bucket (principal/school, clinical director, centre
  // manager) -- same underlying table (institution_staff.id), same
  // kind of task ("approve or reject a pending join"), one key.
  PENDING_STAFF_JOIN: "pending_staff_join",

  // Clinical director (clinic) -- ClinicDirectorDashboard.tsx
  CLINIC_NO_BOOKABLE_SESSION_TYPES: "clinic_no_bookable_session_types",
  CLINIC_EPISODE_NO_ACTIVE_PRACTITIONER: "clinic_episode_no_active_practitioner",
  CLINIC_DRAFT_FBA: "clinic_draft_fba",
  CLINIC_DRAFT_BSP: "clinic_draft_bsp",
  CLINIC_INCOMPLETE_ASSESSMENT: "clinic_incomplete_assessment",
  CLINIC_PENDING_CROSS_ORG_GRANT: "clinic_pending_cross_org_grant",
  CLINIC_SCHOOL_LINK_PENDING_SHARING: "clinic_school_link_pending_sharing",
  CLINIC_STAGNATION_RISING: "clinic_stagnation_rising",

  // Shared across clinical director + clinical lead (same underlying
  // tag_change_requests.id, same kind of decision).
  PENDING_TAG_CHANGE_REQUEST: "pending_tag_change_request",

  // Centre manager (respite centre) -- centre/dashboard/page.tsx
  CENTRE_NEEDS_REPORT: "centre_needs_report",

  // Teacher -- teacher/dashboard/page.tsx. Shared with SNA wherever the
  // identical underlying request appears as a real per-row list (see
  // the exclusion note above for why SNA's own dashboard doesn't have
  // one today).
  ATTESTATION_OWED: "attestation_owed",
  TEACHER_UNSTARTED_INCIDENT: "teacher_unstarted_incident",
  TEACHER_WRITTEN_NOT_SIGNED_OFF: "teacher_written_not_signed_off",
  TEACHER_DEBRIEF_OWED: "teacher_debrief_owed",
  TEACHER_ATTESTATION_ISSUE: "teacher_attestation_issue",
  TEACHER_NO_SNA_ASSIGNED: "teacher_no_sna_assigned",

  // Clinician -- BookingSyncQueueSection.tsx
  BOOKING_NEEDS_ATTENTION: "booking_needs_attention",
} as const;

export type OutstandingTaskQueueKey =
  (typeof OUTSTANDING_TASK_QUEUES)[keyof typeof OUTSTANDING_TASK_QUEUES];
