import { ExportField, ExportSection } from "@/components/export/ExportField";
import type {
  ExportAbcLog,
  ExportAssessment,
  ExportBsp,
  ExportClinicalContentItem,
  ExportClinicalPlan,
  ExportFbaReport,
  ExportIncident,
  ExportSessionNote,
} from "@/lib/clinicalExport";

// PRD 8 Stage 2 -- deliberately NOT a reuse of FbaSectionsReadOnly (the
// FBA reader/print's own component). That component's AFLS sub-section
// does its own internal fetch (useAflsAssessmentsForFba(fbaId)) against
// the CURRENT viewer's session -- fine for the FBA's own author or a
// domain-matched colleague reading their OWN linked report, wrong here:
// a director exporting a colleague's FBA has no clinician_access grant
// of their own on afls_assessments (that table was never extended with
// a director branch, and doing so wasn't part of what was asked for
// this stage), so the sub-fetch would silently return nothing or error
// -- a correctness bug, not a cosmetic gap. Raw instrument-level AFLS
// scores are excluded from this export entirely rather than risk that;
// the FBA's own written analysis (target behaviours, triggers, setting
// events, hypotheses, recommendations, conclusion) is what actually
// answers "what did this assessment conclude", and content_data is
// rendered generically below rather than section-by-section, so nothing
// in it is silently dropped by a label this file doesn't happen to know
// about.

function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.length === 0) return "";
  if (typeof value === "object" && Object.keys(value as object).length === 0) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function FbaReportExportSection({ fba }: { fba: ExportFbaReport }) {
  const entries = Object.entries(fba.contentData ?? {}).filter(([key]) => key !== "afls");
  return (
    <ExportSection
      title={`Functional Behaviour Assessment -- ${fba.status === "completed" ? "Completed" : fba.status}`}
      subtitle={`${fba.clinicianName ?? "Clinician"} · ${formatDate(fba.completedAt ?? fba.createdAt)}`}
    >
      {entries.length === 0 && <ExportField label="Content" value={null} />}
      {entries.map(([key, value]) => (
        <ExportField key={key} label={humanizeKey(key)} value={stringifyValue(value)} />
      ))}
    </ExportSection>
  );
}

export function BspExportSection({ bsp }: { bsp: ExportBsp }) {
  return (
    <ExportSection
      title={`Behaviour Support Plan -- ${bsp.status === "active" ? "Signed" : bsp.status === "superseded" ? "Superseded" : "Draft"}`}
      subtitle={`${bsp.clinicianName ?? "Clinician"} · ${formatDate(bsp.signedAt ?? bsp.createdAt)}`}
    >
      <ExportField label="Target behaviours" value={stringifyValue(bsp.targetBehaviours)} />
      <ExportField label="Triggers" value={stringifyValue(bsp.triggers)} />
      <ExportField label="Setting events" value={stringifyValue(bsp.settingEvents)} />
      <ExportField label="Precursors" value={bsp.precursors} />
      <ExportField label="Current frequency" value={bsp.currentFrequency} />
    </ExportSection>
  );
}

const PLAN_TYPE_LABEL: Record<string, string> = {
  crisis_plan: "Crisis Management Plan",
  sensory_diet_plan: "Sensory Diet Plan",
  aac_plan: "AAC / Communication Plan",
  care_plan: "Care Plan",
  student_support_plan: "Student Support Plan",
};

export function ClinicalPlanExportSection({ plan }: { plan: ExportClinicalPlan }) {
  return (
    <ExportSection
      title={PLAN_TYPE_LABEL[plan.planType] ?? plan.planType}
      subtitle={`${plan.name} · ${plan.clinicianName ?? "Clinician"} · ${formatDate(plan.planDate)}`}
    >
      <ExportField label="Summary" value={plan.body} />
    </ExportSection>
  );
}

export function AssessmentExportSection({ assessment }: { assessment: ExportAssessment }) {
  return (
    <ExportSection
      title={assessment.instrumentName ?? "Assessment"}
      subtitle={`${assessment.clinicianName ?? "Clinician"} · ${formatDate(assessment.completedAt ?? assessment.assessmentDate)}`}
    >
      {assessment.recordType === "response_sheet" ? (
        <>
          <ExportField label="Respondent" value={assessment.respondentType} />
          <ExportField label="Responses" value={stringifyValue(assessment.responses)} />
          <ExportField label="Subscale totals" value={stringifyValue(assessment.subscaleTotals)} />
        </>
      ) : (
        <>
          <ExportField label="Instrument version" value={assessment.instrumentVersion} />
          <ExportField label="Administrator" value={assessment.administratorName} />
          <ExportField label="Location" value={assessment.location} />
          <ExportField label="Scores" value={stringifyValue(assessment.scores)} />
          <ExportField label="Interpretation" value={assessment.interpretation} />
        </>
      )}
    </ExportSection>
  );
}

export function SessionNoteExportSection({ note }: { note: ExportSessionNote }) {
  return (
    <ExportSection title="Session Note" subtitle={`${note.clinicianName ?? "Clinician"} · ${formatDate(note.sessionDate)}`}>
      <ExportField label="Clinical record" value={note.clinicalRecord} />
    </ExportSection>
  );
}

const ITEM_TYPE_LABEL: Record<string, string> = {
  strategy_home: "Strategy (Home)",
  strategy_school: "Strategy (School)",
  strategy_shared: "Strategy (Home & School)",
  trigger: "Trigger",
  setting_event: "Setting Event",
};

export function ClinicalContentExportSection({ items }: { items: ExportClinicalContentItem[] }) {
  if (items.length === 0) return null;
  return (
    <ExportSection title="Published Guidance">
      {items.map((item) => (
        <div key={item.id} className="border-b border-black/5 pb-2 last:border-0">
          <ExportField
            label={`${ITEM_TYPE_LABEL[item.itemType] ?? item.itemType} — ${item.authorName ?? "Clinician"}, ${formatDate(item.createdAt)}`}
            value={stringifyValue(item.content)}
          />
        </div>
      ))}
    </ExportSection>
  );
}

export function AbcLogsExportSection({ logs }: { logs: ExportAbcLog[] }) {
  if (logs.length === 0) return null;
  return (
    <ExportSection title="ABC Logs">
      {logs.map((log) => (
        <ExportField
          key={log.id}
          label={`${formatDate(log.incidentDate)} · ${log.incidentTime}`}
          value={log.loggedByName ? `Logged by ${log.loggedByName}` : "Logged"}
        />
      ))}
    </ExportSection>
  );
}

export function IncidentsExportSection({ incidents }: { incidents: ExportIncident[] }) {
  if (incidents.length === 0) return null;
  return (
    <ExportSection title="Incidents">
      {incidents.map((incident) => (
        <div key={incident.incidentId} className="border-b border-black/5 pb-2 last:border-0">
          <ExportField label={`${incident.category ?? "Incident"} — ${formatDate(incident.occurredAt)}`} value={incident.narrative} />
        </div>
      ))}
    </ExportSection>
  );
}
