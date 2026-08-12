"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { useCalmEscalationNotices } from "@/hooks/useCalmEscalationNotices";

// The high-visibility red card (constraint 3B) -- distinct red accent,
// not the calm-pill/calm-ink pair (that palette is exclusive to the
// Calm button and its own parent-facing flow, per constraint 4; this is
// a clinician-facing emergency alert, a genuinely different meaning,
// so it uses the app's ordinary red-600/red-50 the same way other
// urgent/error states already do elsewhere in this codebase). Persists
// until Acknowledge -- no auto-dismiss, no timeout.
export function CalmEscalationNoticeList() {
  const { notices, isLoading, acknowledge } = useCalmEscalationNotices();
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  if (isLoading || notices.length === 0) return null;

  async function handleAcknowledge(id: string) {
    setAcknowledgingId(id);
    try {
      await acknowledge(id);
    } catch (err) {
      console.error("Failed to acknowledge calm escalation notice:", err);
    } finally {
      setAcknowledgingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 px-4 pt-2">
      {notices.map((notice) => (
        <div key={notice.id} className="rounded-2xl border-2 border-red-500 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-800">
            {notice.childName}&apos;s parent used the emergency escalation at{" "}
            {format(new Date(notice.occurredAt), "d MMM, HH:mm")} — please make contact as soon as possible.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <Link
              href={`/clinician/passport/${notice.passportId}`}
              className="text-sm font-semibold text-red-800 underline underline-offset-2"
            >
              View case
            </Link>
            <button
              type="button"
              onClick={() => handleAcknowledge(notice.id)}
              disabled={acknowledgingId === notice.id}
              className="ml-auto rounded-full bg-red-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {acknowledgingId === notice.id ? "Acknowledging…" : "Acknowledge"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
