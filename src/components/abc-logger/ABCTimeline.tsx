"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { createClient } from "@/lib/supabase/client";
import { ABC_ROLE_DISPLAY_LABEL, type ABCLoggerRole } from "./roleConfig";
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
  intensity: number;
  antecedents: string[] | null;
  antecedent_other: string | null;
  behaviours: string[] | null;
  behaviour_other: string | null;
  consequences: string[] | null;
  consequence_other: string | null;
  sync_status: string | null;
}

interface ABCLogRow {
  id: string;
  loggedByName: string;
  loggedByRole: ABCLoggerRole;
  incidentDate: string;
  incidentTime: string;
  intensity: number;
  antecedents: string[];
  antecedentOther: string | null;
  behaviours: string[];
  behaviourOther: string | null;
  consequences: string[];
  consequenceOther: string | null;
  syncStatus: "synced" | "pending";
  isLocalOnly: boolean;
}

type IntensityFilter = "all" | "mild" | "moderate" | "severe";
type ReporterFilter = "all" | "parent" | "class_teacher" | "clinician";

function truncate(text: string, max = 30): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatChain(items: string[], otherText: string | null): string {
  if (items.length === 0) return "—";
  const first = items[0] === "Other" && otherText ? otherText : items[0];
  const label = truncate(first);
  return items.length > 1 ? `${label} +${items.length - 1} more` : label;
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
        intensity: row.intensity,
        antecedents: row.antecedents ?? [],
        antecedentOther: row.antecedent_other,
        behaviours: row.behaviours ?? [],
        behaviourOther: row.behaviour_other,
        consequences: row.consequences ?? [],
        consequenceOther: row.consequence_other,
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
          intensity: localDraft.intensity ?? 1,
          antecedents: localDraft.antecedents,
          antecedentOther: localDraft.antecedentOther || null,
          behaviours: localDraft.behaviours,
          behaviourOther: localDraft.behaviourOther || null,
          consequences: localDraft.consequences,
          consequenceOther: localDraft.consequenceOther || null,
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
  }, [passportId]);

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
  isHighlighted,
  cardRef,
}: {
  log: ABCLogRow;
  isHighlighted?: boolean;
  cardRef?: Ref<HTMLDivElement>;
}) {
  const badge = getIntensityBadge(log.intensity);

  return (
    <div
      ref={cardRef}
      className={`rounded-2xl border bg-white p-4 shadow-sm transition-colors ${
        isHighlighted ? "border-brand-golden-brown ring-2 ring-brand-golden-brown/40" : "border-black/5"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-brand-neutral-black">
          {formatDateTime(log.incidentDate, log.incidentTime)}
        </p>
        <span
          className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      <p className="mt-2 text-sm text-brand-neutral-black/80">
        {formatChain(log.antecedents, log.antecedentOther)}
        {" → "}
        {formatChain(log.behaviours, log.behaviourOther)}
        {" → "}
        {formatChain(log.consequences, log.consequenceOther)}
      </p>

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
