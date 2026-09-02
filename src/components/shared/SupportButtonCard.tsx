"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Support Button -- stage 2 (raise/close client) of the crisis-
// assistance feature. Replaces a school-wide WhatsApp group: names the
// RAISER and the ROOM, never the child. No confirmation step -- the
// button IS the action. Golden Brown throughout, matching
// CalmEscalationNoticeList's own "persists until acted on" shape
// (Daniel's own instruction: copy that pattern, not school_notices,
// which nothing reads).
//
// THE ROOM IS RESOLVED HERE, AT RAISE TIME -- not server-side. This
// component already has to know the raiser's own classes to decide
// whether to show a picker at all, so passing that same answer to
// raise_support_alert() costs nothing extra and needed no new SQL
// resolver (Daniel's own call, see migration 0153's header).
//
// SCOPE, this stage only: mounted on teacher and SNA dashboards (the
// two roles who can raise). NOT yet wired into every track's nav --
// that ambient "everyone sees it without navigating" surfacing is
// stage 3, deliberately not started (see the separate report on
// realistic reach). Acknowledging and the raiser's own close are both
// built here and fully functional for anyone who has this component
// mounted or navigates to a page that has it -- what's missing is
// PASSIVE surfacing to people who haven't.

interface OpenAlert {
  id: string;
  raised_by: string;
  raised_by_name: string;
  room_names: string[];
  raised_at: string;
  is_own: boolean;
  acknowledgements: { user_id: string; name: string; acknowledged_at: string }[];
}

interface RoomOption {
  id: string;
  name: string;
}

function formatElapsed(isoString: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(isoString).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

async function resolveMyRooms(userId: string, role: "class_teacher" | "sna"): Promise<RoomOption[]> {
  const supabase = createClient();
  const table = role === "class_teacher" ? "class_teachers" : "class_sna_assignments";
  const { data: assignmentRows } = await supabase.from(table).select("class_id").eq("user_id", userId).is("ended_at", null);
  const classIds = [...new Set((assignmentRows ?? []).map((r) => r.class_id as string))];
  if (classIds.length === 0) return [];
  const { data: classRows } = await supabase.from("classes").select("id, name").in("id", classIds);
  return (classRows ?? []) as RoomOption[];
}

export function SupportButtonCard({
  institutionId,
  userId,
  role,
}: {
  institutionId: string;
  userId: string;
  role: "class_teacher" | "sna";
}) {
  const [openAlerts, setOpenAlerts] = useState<OpenAlert[]>([]);
  const [myRooms, setMyRooms] = useState<RoomOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showRoomPicker, setShowRoomPicker] = useState(false);
  const [isRaising, setIsRaising] = useState(false);
  const [raiseError, setRaiseError] = useState<string | null>(null);

  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const [alertsResult, roomsResult] = await Promise.all([
      supabase.rpc("get_active_support_alerts", { p_institution_id: institutionId }),
      resolveMyRooms(userId, role),
    ]);
    if (alertsResult.error) {
      setLoadError("Couldn't load support alerts.");
      setIsLoading(false);
      return;
    }
    setOpenAlerts((alertsResult.data ?? []) as OpenAlert[]);
    setMyRooms(roomsResult);
    setIsLoading(false);
  }, [institutionId, userId, role]);

  useEffect(() => {
    async function run() {
      await load();
    }
    run();
  }, [load]);

  async function raise(roomNames: string[]) {
    setIsRaising(true);
    setRaiseError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("raise_support_alert", {
      p_institution_id: institutionId,
      p_room_names: roomNames,
    });
    setIsRaising(false);
    if (error) {
      setRaiseError(error.message);
      return;
    }
    setShowRoomPicker(false);
    await load();
  }

  function handlePress() {
    if (myRooms.length > 1) {
      setShowRoomPicker(true);
      return;
    }
    // 0 or 1 room -- immediate, no interstitial step. A single class is
    // preselected, not asked about; zero classes raises with no room
    // named at all, per Daniel's own instruction: "still worth more
    // than a refusal."
    raise(myRooms.length === 1 ? [myRooms[0].name] : []);
  }

  async function handleAcknowledge(alertId: string) {
    setAcknowledgingId(alertId);
    const supabase = createClient();
    const { error } = await supabase.rpc("acknowledge_support_alert", { p_support_alert_id: alertId });
    setAcknowledgingId(null);
    if (!error) await load();
  }

  async function handleClose(alertId: string) {
    setClosingId(alertId);
    setCloseError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("close_support_alert", { p_support_alert_id: alertId });
    setClosingId(null);
    if (error) {
      setCloseError(error.message);
      return;
    }
    await load();
  }

  if (isLoading) {
    return <div className="mb-6 h-24 animate-pulse rounded-2xl bg-white" />;
  }

  if (loadError) {
    return (
      <div className="mb-6 rounded-2xl border border-black/5 bg-white p-4 text-center">
        <p className="font-sans text-sm text-brand-neutral-black/60">{loadError}</p>
      </div>
    );
  }

  const myOpenAlert = openAlerts.find((a) => a.is_own);
  const otherOpenAlerts = openAlerts.filter((a) => !a.is_own);

  return (
    <div className="mb-6 flex flex-col gap-3">
      {myOpenAlert ? (
        <div className="rounded-2xl border border-brand-golden-brown bg-brand-golden-brown/10 p-4">
          <p className="font-sans text-sm font-semibold text-brand-golden-brown">
            Support requested{myOpenAlert.room_names.length > 0 ? ` — ${myOpenAlert.room_names.join(", ")}` : ""}
          </p>
          <p className="mt-1 font-sans text-xs text-brand-neutral-black/60">{formatElapsed(myOpenAlert.raised_at)}</p>

          <div className="mt-3">
            {myOpenAlert.acknowledgements.length === 0 ? (
              <p className="font-sans text-sm text-brand-neutral-black/60">Nobody has acknowledged yet.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {myOpenAlert.acknowledgements.map((ack) => (
                  <li key={ack.user_id} className="font-sans text-sm text-brand-neutral-black">
                    {ack.name} · {formatElapsed(ack.acknowledged_at)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {closeError && (
            <p role="alert" className="mt-2 font-sans text-sm font-medium text-brand-golden-brown">
              {closeError}
            </p>
          )}

          <button
            type="button"
            onClick={() => handleClose(myOpenAlert.id)}
            disabled={closingId === myOpenAlert.id}
            className="mt-3 w-full rounded-xl border border-brand-golden-brown py-2.5 text-center font-sans text-sm font-semibold text-brand-golden-brown disabled:opacity-50"
          >
            {closingId === myOpenAlert.id ? "Closing…" : "Close"}
          </button>
        </div>
      ) : showRoomPicker ? (
        <div className="rounded-2xl border border-brand-golden-brown bg-white p-4">
          <p className="mb-2 font-sans text-sm font-semibold text-brand-neutral-black">Which room?</p>
          <div className="flex flex-col gap-2">
            {myRooms.map((room) => (
              <button
                key={room.id}
                type="button"
                onClick={() => raise([room.name])}
                disabled={isRaising}
                className="w-full rounded-xl border border-brand-golden-brown bg-brand-golden-brown/10 py-2.5 text-center font-sans text-sm font-semibold text-brand-golden-brown disabled:opacity-50"
              >
                {room.name}
              </button>
            ))}
          </div>
          {raiseError && (
            <p role="alert" className="mt-2 font-sans text-sm font-medium text-brand-golden-brown">
              {raiseError}
            </p>
          )}
          <button
            type="button"
            onClick={() => setShowRoomPicker(false)}
            disabled={isRaising}
            className="mt-2 w-full rounded-xl border border-black/10 bg-white py-2 text-center font-sans text-sm font-semibold text-black/60"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={handlePress}
            disabled={isRaising}
            className="w-full rounded-2xl border-2 border-brand-golden-brown bg-brand-golden-brown/10 py-3.5 text-center font-sans text-base font-bold text-brand-golden-brown disabled:opacity-50"
          >
            {isRaising ? "Requesting…" : "Support Button"}
          </button>
          {raiseError && (
            <p role="alert" className="mt-2 font-sans text-sm font-medium text-brand-golden-brown">
              {raiseError}
            </p>
          )}
        </div>
      )}

      {otherOpenAlerts.map((alert) => {
        const hasAcknowledged = alert.acknowledgements.some((a) => a.user_id === userId);
        return (
          <div key={alert.id} className="rounded-2xl border border-brand-golden-brown bg-brand-golden-brown/10 p-4">
            <p className="font-sans text-sm font-semibold text-brand-golden-brown">
              {alert.raised_by_name} needs assistance
              {alert.room_names.length > 0 ? ` in ${alert.room_names.join(", ")}` : ""}
            </p>
            <p className="mt-1 font-sans text-xs text-brand-neutral-black/60">{formatElapsed(alert.raised_at)}</p>

            {alert.acknowledgements.length > 0 && (
              <p className="mt-2 font-sans text-xs text-brand-neutral-black/60">
                Acknowledged by {alert.acknowledgements.map((a) => a.name).join(", ")}
              </p>
            )}

            <button
              type="button"
              onClick={() => handleAcknowledge(alert.id)}
              disabled={hasAcknowledged || acknowledgingId === alert.id}
              className="mt-3 w-full rounded-xl bg-brand-golden-brown py-2.5 text-center font-sans text-sm font-semibold text-white disabled:opacity-50"
            >
              {hasAcknowledged ? "Acknowledged" : acknowledgingId === alert.id ? "Acknowledging…" : "Acknowledge"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
