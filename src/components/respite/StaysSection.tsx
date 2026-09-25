"use client";

import { useState } from "react";
import { useRespiteStays } from "@/hooks/useRespiteStays";

function countdownLabel(startsAt: string): string {
  const diffMs = new Date(startsAt).getTime() - Date.now();
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Starting today";
  if (days === 1) return "Starts in 1 day";
  return `Starts in ${days} days`;
}

// TIER 1, items 2 and 3 of the reachability pass -- schedule a stay
// (create_respite_stay()) and activate/end-activation
// (activate_respite_stay()/close_respite_activation()) both had real,
// verified RPCs and no trigger anywhere in the client. centre_manager
// only -- care_staff never schedules or activates, matching every
// other respite-authority action in this PRD.
export function StaysSection({ episodeId }: { episodeId: string }) {
  const { stays, activeStayIds, isLoading, error, scheduleStay, activate, closeActivation } =
    useRespiteStays(episodeId);
  const [isScheduling, setIsScheduling] = useState(false);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [busyStayId, setBusyStayId] = useState<string | null>(null);

  if (isLoading) return null;

  async function handleSchedule() {
    if (!starts || !ends) return;
    setIsSaving(true);
    const ok = await scheduleStay(new Date(starts), new Date(ends));
    setIsSaving(false);
    if (ok) {
      setIsScheduling(false);
      setStarts("");
      setEnds("");
    }
  }

  async function handleActivate(stayId: string) {
    setBusyStayId(stayId);
    await activate(stayId);
    setBusyStayId(null);
  }

  async function handleClose(stayId: string) {
    setBusyStayId(stayId);
    await closeActivation(stayId);
    setBusyStayId(null);
  }

  return (
    <section className="mb-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
        Stays
      </h2>

      {stays.length === 0 && <p className="mb-3 text-sm text-black/40">No stays scheduled yet.</p>}

      <div className="flex flex-col gap-2">
        {stays.map((stay) => {
          const isActive = activeStayIds.has(stay.id);
          const isBusy = busyStayId === stay.id;
          return (
            <div key={stay.id} className="rounded-lg bg-brand-off-white/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-brand-neutral-black">
                    {new Date(stay.startsAt).toLocaleDateString()} -- {new Date(stay.endsAt).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-black/50">
                    {stay.status === "upcoming" && countdownLabel(stay.startsAt)}
                    {stay.status === "current" && "In progress"}
                    {stay.status === "completed" && "Completed"}
                    {isActive && " -- Active"}
                  </p>
                </div>
                {stay.status !== "completed" &&
                  (isActive ? (
                    <button
                      type="button"
                      onClick={() => handleClose(stay.id)}
                      disabled={isBusy}
                      className="shrink-0 rounded-full bg-black/5 px-3 py-1.5 text-xs font-semibold text-brand-neutral-black disabled:opacity-50"
                    >
                      End activation
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleActivate(stay.id)}
                      disabled={isBusy}
                      className="shrink-0 rounded-full bg-brand-golden-brown px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Activate
                    </button>
                  ))}
              </div>
            </div>
          );
        })}
      </div>

      {error && <p role="alert" className="mt-3 text-sm font-medium text-red-600">{error}</p>}

      {!isScheduling ? (
        <button
          type="button"
          onClick={() => setIsScheduling(true)}
          className="mt-3 text-sm font-semibold text-brand-prussian-blue"
        >
          Schedule a stay
        </button>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <label className="text-xs font-semibold text-black/60">
            Starts
            <input
              type="datetime-local"
              value={starts}
              onChange={(e) => setStarts(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-black/60">
            Ends
            <input
              type="datetime-local"
              value={ends}
              onChange={(e) => setEnds(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSchedule}
              disabled={isSaving || !starts || !ends}
              className="rounded-full bg-brand-prussian-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setIsScheduling(false)}
              className="rounded-full px-4 py-2 text-sm font-semibold text-black/60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
