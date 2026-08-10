"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ABC_ROLE_DISPLAY_LABEL, type ABCLoggerRole } from "@/components/abc-logger/roleConfig";
import { ABC_FUNCTION_LABELS, ABC_FUNCTION_OPTIONS, type AbcHypothesisedFunction } from "@/lib/fba/types";
import type { AbcLogSummary } from "@/lib/fba/abcAnalysis";

function truncate(text: string, max = 30): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatChain(items: string[], otherText: string | null): string {
  if (items.length === 0) return "—";
  const first = items[0] === "Other" && otherText ? otherText : items[0];
  const label = truncate(first);
  return items.length > 1 ? `${label} +${items.length - 1} more` : label;
}

function formatDateTime(date: string, time: string): string {
  const d = new Date(`${date}T${time}`);
  if (Number.isNaN(d.getTime())) return `${date} ${time}`;
  const dateLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const timeLabel = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${dateLabel} · ${timeLabel}`;
}

function formatList(items: string[], otherText: string | null): string {
  if (items.length === 0) return "—";
  return items.map((item) => (item === "Other" && otherText ? otherText : item)).join(", ");
}

// Read-only by construction -- this view must never let a clinician edit
// the underlying abc_logs row (the brief's explicit requirement). The
// only thing this card writes anywhere is the function tag, and that
// goes to the FBA's own content_data, never back to abc_logs.
export function AbcIncidentCard({
  log,
  tag,
  onTagChange,
  readOnly,
}: {
  log: AbcLogSummary;
  tag: AbcHypothesisedFunction | undefined;
  onTagChange: (tag: AbcHypothesisedFunction | undefined) => void;
  readOnly: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const roleLabel = ABC_ROLE_DISPLAY_LABEL[log.loggedByRole as ABCLoggerRole] ?? log.loggedByRole;

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-brand-neutral-black">
            {formatDateTime(log.incidentDate, log.incidentTime)}
          </p>
          <p className="mt-0.5 text-xs text-brand-neutral-black/50">
            {log.loggedByName} ({roleLabel})
          </p>
        </div>
        <ChevronDown
          className={`h-5 w-5 flex-shrink-0 text-brand-neutral-black/30 transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      </button>

      <p className="mt-2 text-sm text-brand-neutral-black/80">
        {formatChain(log.antecedents, log.antecedentOther)}
        {" → "}
        {formatChain(log.behaviours, log.behaviourOther)}
        {" → "}
        {formatChain(log.consequences, log.consequenceOther)}
      </p>

      {isExpanded && (
        <div className="mt-3 flex flex-col gap-2 border-t border-black/5 pt-3 text-sm">
          <DetailRow label="Antecedent" value={formatList(log.antecedents, log.antecedentOther)} />
          <DetailRow label="Behaviour" value={formatList(log.behaviours, log.behaviourOther)} />
          <DetailRow label="Consequence" value={formatList(log.consequences, log.consequenceOther)} />
          <DetailRow label="Intensity" value={`${log.intensity} / 5`} />
          <DetailRow
            label="Duration"
            value={log.durationMinutes ? `${log.durationMinutes} min` : "Not recorded"}
          />
          {log.perceivedFunction && (
            <DetailRow label="Perceived function (at time of logging)" value={log.perceivedFunction} />
          )}
          {log.generalNotes && <DetailRow label="Notes" value={log.generalNotes} />}
        </div>
      )}

      <div className="mt-3 border-t border-black/5 pt-3">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/40">
          Hypothesised Function
        </p>
        {readOnly ? (
          <p className="text-sm text-brand-neutral-black">
            {tag ? ABC_FUNCTION_LABELS[tag] : "Untagged"}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {ABC_FUNCTION_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onTagChange(tag === option ? undefined : option)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  tag === option
                    ? "border border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                    : "border border-black/10 bg-white text-brand-neutral-black/70"
                }`}
              >
                {ABC_FUNCTION_LABELS[option]}
              </button>
            ))}
          </div>
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
