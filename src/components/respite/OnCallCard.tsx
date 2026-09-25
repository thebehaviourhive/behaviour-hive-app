"use client";

import { useState } from "react";
import { useRespiteOnCall } from "@/hooks/useRespiteOnCall";

// TIME-BASED, never a green dot -- a stale on_call_until reads as
// obviously stale ("until 6am -- 3 hours ago"), which a boolean never
// would. tap-to-call via a plain tel: link. No in-app escalation --
// escalation is by phone, per Daniel's own instruction.
function formatUntil(iso: string): { text: string; isStale: boolean } {
  const until = new Date(iso);
  const now = new Date();
  const isStale = until.getTime() < now.getTime();
  const sameDay = until.toDateString() === now.toDateString();
  const time = until.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = sameDay ? "today" : until.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return { text: `until ${time} ${day}`, isStale };
}

export function OnCallCard({
  institutionId,
  canSet,
  showHeading = true,
}: {
  institutionId: string | null;
  canSet: boolean;
  // Respite UI Stage 2a -- the dashboard's own "Who is On" block wraps
  // this card with its own section heading (matching the other three
  // blocks), which would otherwise duplicate this card's built-in "On
  // call" heading. Settings keeps the default (true) -- it has no
  // section heading of its own for this card to sit under.
  showHeading?: boolean;
}) {
  const { current, isLoading, error, setOnCall } = useRespiteOnCall(institutionId);
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [untilTime, setUntilTime] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  if (isLoading) return null;

  async function handleSave() {
    if (!name.trim() || !phone.trim() || !untilTime) return;
    setIsSaving(true);
    const until = new Date(untilTime);
    const ok = await setOnCall(name, phone, until);
    setIsSaving(false);
    if (ok) {
      setIsEditing(false);
      setName("");
      setPhone("");
      setUntilTime("");
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      {showHeading && (
        <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
          On call
        </h2>
      )}

      {current ? (
        (() => {
          const { text, isStale } = formatUntil(current.onCallUntil);
          return (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-brand-neutral-black">{current.name}</p>
                <p className={`text-sm ${isStale ? "font-semibold text-brand-golden-brown" : "text-black/60"}`}>
                  {text}
                  {isStale ? " -- may be out of date" : ""}
                </p>
              </div>
              <a
                href={`tel:${current.phone.replace(/[^0-9+]/g, "")}`}
                className="shrink-0 rounded-full bg-brand-prussian-blue px-4 py-2 text-sm font-semibold text-white"
              >
                Call
              </a>
            </div>
          );
        })()
      ) : (
        <p className="text-sm text-black/60">No on-call contact set.</p>
      )}

      {canSet && !isEditing && (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="mt-3 text-sm font-semibold text-brand-prussian-blue"
        >
          {current ? "Update on-call" : "Set on-call"}
        </button>
      )}

      {canSet && isEditing && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-black/10 px-3 py-2 text-sm"
          />
          <input
            type="tel"
            placeholder="Phone number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="rounded-lg border border-black/10 px-3 py-2 text-sm"
          />
          <input
            type="datetime-local"
            value={untilTime}
            onChange={(e) => setUntilTime(e.target.value)}
            className="rounded-lg border border-black/10 px-3 py-2 text-sm"
          />
          {error && <p role="alert" className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="rounded-full bg-brand-prussian-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="rounded-full px-4 py-2 text-sm font-semibold text-black/60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
