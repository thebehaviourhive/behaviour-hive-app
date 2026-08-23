"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ABC_ROLE_DISPLAY_LABEL,
  OTHER_OPTION,
  PERCEIVED_FUNCTION_LABELS,
  type ABCLoggerRole,
} from "./roleConfig";
import { loadDraft } from "./draftStorage";

interface ABCTimelineProps {
  passportId: string;
  viewerRole: ABCLoggerRole;
  // Stage 3A: "View log" on an incident-note message deep-links here.
  // Scrolls to and highlights the matching card once logs have loaded;
  // also forces both filter rows back to "All" so a stale filter
  // selection can never hide the very card someone was sent to see.
  highlightLogId?: string | null;
}

interface RawAbcLogRow {
  id: string;
  logged_by_name: string | null;
  logged_by_role: string;
  incident_date: string;
  incident_time: string;
  duration_minutes: number | null;
  intensity: number;
  antecedents: string[] | null;
  antecedent_other: string | null;
  behaviours: string[] | null;
  behaviour_other: string | null;
  consequences: string[] | null;
  consequence_other: string | null;
  sensory_sought: string[] | null;
  sensory_avoided: string[] | null;
  sensory_sought_other: string | null;
  sensory_avoided_other: string | null;
  // Already role-gated server-side by get_abc_logs() itself (SQL CASE:
  // null unless the caller is a verified, actively-linked clinician) --
  // this component's job is only to render whatever comes back, never
  // to re-derive who's "allowed" to see it. clinical_notes isn't in
  // this list at all because the RPC never selects it for any caller.
  // perceived_function_other follows the identical gate (migration
  // 0067) -- always null in the payload for a non-clinician viewer,
  // same as perceived_function itself.
  perceived_function: string | null;
  perceived_function_other: string | null;
  general_notes: string | null;
  sync_status: string | null;
}

interface ABCLogRow {
  id: string;
  loggedByName: string;
  loggedByRole: ABCLoggerRole;
  incidentDate: string;
  incidentTime: string;
  durationMinutes: number | null;
  intensity: number;
  antecedents: string[];
  antecedentOther: string | null;
  behaviours: string[];
  behaviourOther: string | null;
  consequences: string[];
  consequenceOther: string | null;
  sensorySought: string[];
  sensoryAvoided: string[];
  sensorySoughtOther: string | null;
  sensoryAvoidedOther: string | null;
  perceivedFunction: string | null;
  perceivedFunctionOther: string | null;
  generalNotes: string | null;
  syncStatus: "synced" | "pending";
  isLocalOnly: boolean;
}

type IntensityFilter = "all" | "mild" | "moderate" | "severe";
type ReporterFilter = "all" | "parent" | "class_teacher" | "clinician" | "sna";

function truncate(text: string, max = 30): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatChain(items: string[], otherText: string | null): string {
  if (items.length === 0) return "—";
  const first = items[0] === OTHER_OPTION && otherText ? otherText : items[0];
  const label = truncate(first);
  return items.length > 1 ? `${label} +${items.length - 1} more` : label;
}

// Expanded-detail counterpart to formatChain -- every item spelled out
// in full, no truncation, matching AbcIncidentCard's own formatList
// (the pattern being generalised here).
function formatList(items: string[], otherText: string | null): string {
  if (items.length === 0) return "—";
  return items.map((item) => (item === OTHER_OPTION && otherText ? otherText : item)).join(", ");
}

// The "Why" question stores a short code (attention/escape/tangible/
// automatic/other), not display text -- unlike antecedents/behaviours/
// consequences, which store the real option string. Maps back to the
// same label shown at logging time, with the free-text description
// appended when the code is "other".
function formatPerceivedFunction(value: string, otherText: string | null): string {
  const label = PERCEIVED_FUNCTION_LABELS[value] ?? value;
  return value === "other" && otherText ? otherText : label;
}

function getIntensityBadge(intensity: number): {
  label: string;
  filterValue: Exclude<IntensityFilter, "all">;
  className: string;
} {
  if (intensity <= 2) {
    return { label: "Mild", filterValue: "mild", className: "bg-green-50 text-green-800" };
  }
  if (intensity === 3) {
    return { label: "Moderate", filterValue: "moderate", className: "bg-amber-50 text-amber-800" };
  }
  return { label: "Severe", filterValue: "severe", className: "bg-red-50 text-red-800" };
}

function formatDateTime(date: string, time: string): string {
  const d = new Date(`${date}T${time}`);
  if (Number.isNaN(d.getTime())) return `${date} ${time}`;
  const dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeLabel = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${dateLabel} · ${timeLabel}`;
}

export function ABCTimeline({ passportId, viewerRole, highlightLogId }: ABCTimelineProps) {
  const [logs, setLogs] = useState<ABCLogRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [intensityFilter, setIntensityFilter] = useState<IntensityFilter>("all");
  const [reporterFilter, setReporterFilter] = useState<ReporterFilter>("all");
  const highlightRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_abc_logs", {
        p_passport_id: passportId,
      });

      if (!isMounted) return;

      if (error) {
        setLoadError("We couldn't load the incident timeline. Please try again.");
        setIsLoading(false);
        return;
      }

      const rows: ABCLogRow[] = ((data ?? []) as RawAbcLogRow[]).map((row) => ({
        id: row.id,
        loggedByName: row.logged_by_name ?? "Someone",
        loggedByRole: row.logged_by_role as ABCLoggerRole,
        incidentDate: row.incident_date,
        incidentTime: row.incident_time,
        durationMinutes: row.duration_minutes,
        intensity: row.intensity,
        antecedents: row.antecedents ?? [],
        antecedentOther: row.antecedent_other,
        behaviours: row.behaviours ?? [],
        behaviourOther: row.behaviour_other,
        consequences: row.consequences ?? [],
        consequenceOther: row.consequence_other,
        sensorySought: row.sensory_sought ?? [],
        sensoryAvoided: row.sensory_avoided ?? [],
        sensorySoughtOther: row.sensory_sought_other,
        sensoryAvoidedOther: row.sensory_avoided_other,
        perceivedFunction: row.perceived_function,
        perceivedFunctionOther: row.perceived_function_other,
        generalNotes: row.general_notes,
        syncStatus: (row.sync_status as "synced" | "pending") ?? "synced",
        isLocalOnly: false,
      }));

      // A pending offline draft lives only in this device's localStorage,
      // never in the DB (see ABCLogger) -- surfaced here so "will sync
      // when connection is restored" has something visible to point at,
      // rather than being a promise with no evidence behind it.
      const localDraft = loadDraft(passportId);
      if (localDraft && localDraft.isDraft && localDraft.syncStatus === "pending") {
        rows.unshift({
          id: "local-draft",
          loggedByName: "You",
          loggedByRole: localDraft.role,
          incidentDate: localDraft.incidentDate,
          incidentTime: localDraft.incidentTime,
          durationMinutes: localDraft.durationMinutes ? Number(localDraft.durationMinutes) : null,
          intensity: localDraft.intensity ?? 1,
          antecedents: localDraft.antecedents,
          antecedentOther: localDraft.antecedentOther || null,
          behaviours: localDraft.behaviours,
          behaviourOther: localDraft.behaviourOther || null,
          consequences: localDraft.consequences,
          consequenceOther: localDraft.consequenceOther || null,
          sensorySought: localDraft.sensorySought,
          sensoryAvoided: localDraft.sensoryAvoided,
          sensorySoughtOther: localDraft.sensorySoughtOther || null,
          sensoryAvoidedOther: localDraft.sensoryAvoidedOther || null,
          // A pending local draft never went through get_abc_logs()'s own
          // SQL CASE (it hasn't synced yet), so the same clinician-only
          // gate is applied here in JS instead -- otherwise a non-
          // clinician author would see their own "Why" answer echoed back
          // for the few seconds before it syncs, then have it vanish the
          // moment the real, gated row replaces this local one. Same rule
          // (protection model (i)), same viewer, no exception for "it's
          // only local".
          perceivedFunction: viewerRole === "clinician" ? localDraft.perceivedFunction : null,
          perceivedFunctionOther: viewerRole === "clinician" ? localDraft.perceivedFunctionOther || null : null,
          generalNotes: localDraft.generalNotes || null,
          syncStatus: "pending",
          isLocalOnly: true,
        });
      }

      setLogs(rows);
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [passportId, viewerRole]);

  // A deep-linked log must never be hidden by a stale filter selection
  // left over from a previous visit to this timeline.
  useEffect(() => {
    if (!highlightLogId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIntensityFilter("all");
    setReporterFilter("all");
  }, [highlightLogId]);

  useEffect(() => {
    if (!highlightLogId || isLoading) return;
    // Deferred a tick so the cards have painted before scrolling.
    const timer = setTimeout(() => {
      highlightRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    return () => clearTimeout(timer);
  }, [highlightLogId, isLoading, logs]);

  const filteredLogs = logs.filter((log) => {
    if (intensityFilter !== "all" && getIntensityBadge(log.intensity).filterValue !== intensityFilter) {
      return false;
    }
    if (reporterFilter !== "all" && log.loggedByRole !== reporterFilter) {
      return false;
    }
    return true;
  });

  if (isLoading) {
    return null;
  }

  if (loadError) {
    return <p className="text-sm text-brand-neutral-black/60">{loadError}</p>;
  }

  return (
    // Both roles currently see identical rows -- the visibility rules
    // are symmetric today -- but viewerRole stays a real prop (not just
    // accepted-and-ignored) so a future role with different visibility
    // (e.g. clinician) has a value to branch on here without changing
    // this component's public signature or its callers.
    <div data-viewer-role={viewerRole}>
      <div className="mb-4 flex flex-wrap gap-2">
        <FilterPill label="All" isActive={intensityFilter === "all"} onClick={() => setIntensityFilter("all")} />
        <FilterPill label="Mild" isActive={intensityFilter === "mild"} onClick={() => setIntensityFilter("mild")} />
        <FilterPill
          label="Moderate"
          isActive={intensityFilter === "moderate"}
          onClick={() => setIntensityFilter("moderate")}
        />
        <FilterPill
          label="Severe"
          isActive={intensityFilter === "severe"}
          onClick={() => setIntensityFilter("severe")}
        />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <FilterPill label="All" isActive={reporterFilter === "all"} onClick={() => setReporterFilter("all")} />
        <FilterPill
          label="Parent"
          isActive={reporterFilter === "parent"}
          onClick={() => setReporterFilter("parent")}
        />
        <FilterPill
          label="Teacher"
          isActive={reporterFilter === "class_teacher"}
          onClick={() => setReporterFilter("class_teacher")}
        />
        <FilterPill
          label="Clinician"
          isActive={reporterFilter === "clinician"}
          onClick={() => setReporterFilter("clinician")}
        />
        <FilterPill
          label="SNA"
          isActive={reporterFilter === "sna"}
          onClick={() => setReporterFilter("sna")}
        />
      </div>

      {filteredLogs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
          No incidents logged yet. Tap Log Incident to add the first entry.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredLogs.map((log) => (
            <ABCLogCard
              key={log.id}
              log={log}
              viewerRole={viewerRole}
              isHighlighted={log.id === highlightLogId}
              cardRef={log.id === highlightLogId ? highlightRef : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ABCLogCard({
  log,
  viewerRole,
  isHighlighted,
  cardRef,
}: {
  log: ABCLogRow;
  viewerRole: ABCLoggerRole;
  isHighlighted?: boolean;
  cardRef?: Ref<HTMLDivElement>;
}) {
  // Generalised from AbcIncidentCard (the FBA workspace's clinician-only
  // card, which already had this) rather than forked per track -- one
  // expand/collapse implementation, shared by every viewerRole. A
  // deep-linked card (Messages' "View log", or a highlighted deep link
  // more generally) opens pre-expanded, since the whole point of that
  // link is to show the detail, not just confirm the card exists.
  const [isExpanded, setIsExpanded] = useState(Boolean(isHighlighted));
  const badge = getIntensityBadge(log.intensity);
  // Governance change: a teacher's (and, per the same rule, an SNA's)
  // visible set is now only their own logs plus ones explicitly shared
  // with them via an incident message -- so for either viewer, any row
  // NOT logged by that same role is, by construction, a shared one.
  // Labelled subtly (not a status pill like intensity) so it reads as
  // provenance, not as an alert.
  const isSharedWithTeacher =
    (viewerRole === "class_teacher" || viewerRole === "sna") && log.loggedByRole !== viewerRole;

  return (
    <div
      ref={cardRef}
      className={`rounded-2xl border bg-white p-4 shadow-sm transition-colors ${
        isHighlighted ? "border-brand-golden-brown ring-2 ring-brand-golden-brown/40" : "border-black/5"
      }`}
    >
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <p className="text-sm font-semibold text-brand-neutral-black">
          {formatDateTime(log.incidentDate, log.incidentTime)}
        </p>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {isSharedWithTeacher && (
            <span className="rounded-full bg-brand-off-white px-2.5 py-1 text-xs font-semibold text-brand-neutral-black/50">
              Shared by {ABC_ROLE_DISPLAY_LABEL[log.loggedByRole]}
            </span>
          )}
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}
          >
            {badge.label}
          </span>
          <ChevronDown
            className={`h-4 w-4 flex-shrink-0 text-brand-neutral-black/30 transition-transform ${isExpanded ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      <p className="mt-2 text-sm text-brand-neutral-black/80">
        {formatChain(log.antecedents, log.antecedentOther)}
        {" → "}
        {formatChain(log.behaviours, log.behaviourOther)}
        {" → "}
        {formatChain(log.consequences, log.consequenceOther)}
      </p>

      {isExpanded && (
        // Full detail, exactly what this viewer's own get_abc_logs()
        // response already contains for this row -- nothing re-fetched,
        // nothing re-gated here. perceivedFunction is already null in
        // the payload itself for a non-clinician viewer (the RPC's own
        // SQL CASE), so it's structurally absent for teacher/SNA/parent,
        // not hidden by a role check in this component; clinical_notes
        // was never selected by the RPC for anyone, so there's no field
        // to accidentally render at all.
        <div className="mt-3 flex flex-col gap-2 border-t border-black/5 pt-3 text-sm">
          <DetailRow label="Antecedent" value={formatList(log.antecedents, log.antecedentOther)} />
          <DetailRow label="Behaviour" value={formatList(log.behaviours, log.behaviourOther)} />
          <DetailRow label="Consequence" value={formatList(log.consequences, log.consequenceOther)} />
          <DetailRow label="Intensity" value={`${log.intensity} / 5`} />
          <DetailRow
            label="Duration"
            value={log.durationMinutes ? `${log.durationMinutes} min` : "Not recorded"}
          />
          {log.sensorySought.length > 0 && (
            <DetailRow label="Sensory areas sought" value={formatList(log.sensorySought, log.sensorySoughtOther)} />
          )}
          {log.sensoryAvoided.length > 0 && (
            <DetailRow label="Sensory areas avoided" value={formatList(log.sensoryAvoided, log.sensoryAvoidedOther)} />
          )}
          {/* perceivedFunction is already null in the payload for a
              non-clinician viewer (get_abc_logs()'s own SQL CASE) --
              structurally absent, not hidden by a role check here, and
              that now applies to every role including the log's own
              author (protection model (i)). Value is a short code, not
              display text, so it's mapped through formatPerceivedFunction
              rather than rendered raw. */}
          {log.perceivedFunction && (
            <DetailRow
              label="Why (shared with the clinical team)"
              value={formatPerceivedFunction(log.perceivedFunction, log.perceivedFunctionOther)}
            />
          )}
          {log.generalNotes && <DetailRow label="Notes" value={log.generalNotes} />}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="font-accent text-xs text-brand-neutral-black/60">
          Logged by {log.loggedByName} ({ABC_ROLE_DISPLAY_LABEL[log.loggedByRole]})
        </p>
        {log.syncStatus === "pending" && (
          <span className="flex flex-shrink-0 items-center gap-1 text-xs text-brand-neutral-black/50">
            <span aria-hidden>🕐</span>
            Pending sync
          </span>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-brand-neutral-black/50">{label}</p>
      <p className="text-brand-neutral-black">{value}</p>
    </div>
  );
}

function FilterPill({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
        isActive
          ? "bg-brand-prussian-blue text-white"
          : "bg-brand-off-white text-brand-neutral-black/70"
      }`}
    >
      {label}
    </button>
  );
}
