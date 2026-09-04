"use client";

import { useState } from "react";
import { HandHelping } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useSupportAlertStatus } from "@/hooks/useSupportAlertStatus";

// Support Button, nav rework. Produces the two pieces AppBottomNav's
// own alertSlot/extraSlot props need, from one shared poll (0154). Used
// by teacher, SNA (both raise + acknowledge), and principal, both
// surfaces (acknowledge only -- role is null there, raise_support_
// alert()'s own role check never permits a principal to raise, so no
// idle button renders for them at all, only the alert strip when one
// exists).
//
// THE ROOM PICKER stays a BottomSheet, not squeezed into the slim nav
// strip -- only shown for 2+ classes; 0 or 1 is immediate, matching the
// original spec ("a single class preselected, not asked about; zero
// classes raises with no room named").
//
// PER-PERSON ACKNOWLEDGEMENT (Daniel's rule 2): once I've acknowledged
// someone ELSE's alert, MY nav returns to normal -- I know it happened.
// It stays transformed for everyone who hasn't. Only the raiser's own
// Close clears it for everyone. showAlert below is exactly that rule.
//
// TWO CONCURRENT ALERTS: get_my_support_alert_status() already resolves
// to the most recently raised and returns otherOpenAlertCount --
// surfaced here as "+N more" so the nav never states a single room when
// more than one needs help.

interface RoomOption {
  id: string;
  name: string;
}

async function resolveMyRooms(userId: string, role: "class_teacher" | "sna"): Promise<RoomOption[]> {
  const supabase = createClient();
  const table = role === "class_teacher" ? "class_teachers" : "class_sna_assignments";
  const { data: assignmentRows } = await supabase
    .from(table)
    .select("class_id")
    .eq("user_id", userId)
    .is("ended_at", null);
  const classIds = [...new Set((assignmentRows ?? []).map((r) => r.class_id as string))];
  if (classIds.length === 0) return [];
  const { data: classRows } = await supabase.from("classes").select("id, name").in("id", classIds);
  return (classRows ?? []) as RoomOption[];
}

export function useSupportButtonNavSlots({
  institutionId,
  userId,
  role,
}: {
  institutionId: string | null;
  userId: string | null;
  // null for principal -- can view and acknowledge, cannot raise
  // (raise_support_alert()'s own role check permits class_teacher/sna
  // only), so no idle button ever renders for them.
  role: "class_teacher" | "sna" | null;
}) {
  const { status, refresh } = useSupportAlertStatus(institutionId, userId);

  const [isRoomPickerOpen, setIsRoomPickerOpen] = useState(false);
  const [myRooms, setMyRooms] = useState<RoomOption[]>([]);
  const [isRaising, setIsRaising] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [raiseError, setRaiseError] = useState<string | null>(null);
  const [alertActionError, setAlertActionError] = useState<string | null>(null);

  async function openPickerOrRaise() {
    if (!userId || !role) return;
    setRaiseError(null);
    const rooms = await resolveMyRooms(userId, role);
    if (rooms.length > 1) {
      setMyRooms(rooms);
      setIsRoomPickerOpen(true);
      return;
    }
    await raise(rooms.length === 1 ? [rooms[0].name] : []);
  }

  async function raise(roomNames: string[]) {
    if (!institutionId) return;
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
    setIsRoomPickerOpen(false);
    await refresh();
  }

  async function acknowledge() {
    if (!status) return;
    setIsActing(true);
    setAlertActionError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("acknowledge_support_alert", {
      p_support_alert_id: status.alertId,
    });
    setIsActing(false);
    if (error) {
      setAlertActionError(error.message);
      return;
    }
    await refresh();
  }

  async function close() {
    if (!status) return;
    setIsActing(true);
    setAlertActionError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("close_support_alert", {
      p_support_alert_id: status.alertId,
    });
    setIsActing(false);
    if (error) {
      setAlertActionError(error.message);
      return;
    }
    await refresh();
  }

  const showAlert = status !== null && !(status.iAcknowledged && !status.isOwn);
  const roomSummary = status && status.roomNames.length > 0 ? status.roomNames.join(", ") : null;
  const moreSuffix = status && status.otherOpenAlertCount > 0 ? ` · +${status.otherOpenAlertCount} more` : "";

  const alertSlot =
    showAlert && status ? (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {status.isOwn ? (
            <>
              {/* No reach copy here -- they've already pressed it.
                  Removed per Daniel's own instruction: it only ever
                  belonged BEFORE the action, which for a raiser with
                  2+ classes is the room-picker sheet (still shows it,
                  reworded for 5s polling) -- not after. A raiser with
                  0 or 1 classes, who never sees that sheet, now never
                  sees this copy at all; flagged in the report rather
                  than silently accepted. */}
              <p className="font-sans text-sm font-semibold text-white">
                Support Requested{roomSummary ? ` - ${roomSummary}` : ""}
              </p>
              <p className="font-sans text-xs text-white/80">
                {status.acknowledgementCount} acknowledged{moreSuffix}
              </p>
            </>
          ) : (
            <p className="font-sans text-sm font-semibold text-white">
              {/* The name stays -- kept deliberately, not dropped.
                  Daniel's own stated reasoning for questioning it is
                  the reasoning for keeping it: the name is what tells
                  a colleague whether it's their own class teacher
                  asking, which is exactly the information they need
                  to decide whether to go. See the report. */}
              {status.raisedByName ?? "A colleague"} needs assistance{roomSummary ? ` in ${roomSummary}` : ""}
              {moreSuffix}
            </p>
          )}
          {alertActionError && <p className="mt-0.5 font-sans text-xs text-white">{alertActionError}</p>}
        </div>
        <button
          type="button"
          onClick={status.isOwn ? close : acknowledge}
          disabled={isActing}
          className="flex-shrink-0 rounded-full bg-white px-3 py-1.5 font-sans text-xs font-semibold text-brand-support-red disabled:opacity-50"
        >
          {status.isOwn ? (isActing ? "Closing…" : "Close") : isActing ? "Acknowledging…" : "Acknowledge"}
        </button>
      </div>
    ) : null;

  const extraSlot =
    role && !showAlert ? (
      <div className="relative flex min-h-[44px] flex-1 items-center justify-center">
        <button
          type="button"
          onClick={openPickerOrRaise}
          disabled={isRaising}
          aria-label="Support Button"
          className="flex flex-col items-center gap-0.5 rounded-2xl bg-brand-support-red/10 px-3.5 py-1.5 disabled:opacity-50"
        >
          <HandHelping aria-hidden size={24} strokeWidth={2} className="text-brand-support-red" />
          <span className="font-sans text-[10px] font-semibold leading-none text-brand-support-red">Support</span>
        </button>
        {/* Daniel's own instruction, reversed: the "reaches staff with
            the app open, not a locked phone" caption was asked for when
            the alert reached people unpredictably; 5s polling (item 3,
            an earlier pass) brought that under three seconds and the
            copy was never revisited. Standing text under a crisis
            button explaining a technical limitation isn't read
            mid-crisis, and it makes the button read as unreliable
            exactly when a teacher needs to trust it. raiseError still
            renders here when a raise genuinely fails -- that's a real
            error, not the removed standing caption. */}
        {raiseError && (
          <p role="alert" className="absolute bottom-full mb-1 w-36 text-center font-sans text-[10px] font-medium text-brand-support-red">
            {raiseError}
          </p>
        )}

        {isRoomPickerOpen && (
          <BottomSheet isOpen={isRoomPickerOpen} onClose={() => setIsRoomPickerOpen(false)}>
            <h2 className="font-heading text-lg font-bold text-brand-neutral-black">Which room?</h2>
            <div className="mt-4 flex flex-col gap-2">
              {myRooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => raise([room.name])}
                  disabled={isRaising}
                  className="w-full rounded-xl border border-brand-support-red bg-brand-support-red/10 py-2.5 text-center font-sans text-sm font-semibold text-brand-support-red disabled:opacity-50"
                >
                  {room.name}
                </button>
              ))}
            </div>
            {raiseError && (
              <p role="alert" className="mt-3 font-sans text-sm font-medium text-brand-support-red">
                {raiseError}
              </p>
            )}
            <button
              type="button"
              onClick={() => setIsRoomPickerOpen(false)}
              disabled={isRaising}
              className="mt-2 w-full rounded-xl border border-black/10 bg-white py-2 text-center font-sans text-sm font-semibold text-black/60"
            >
              Cancel
            </button>
          </BottomSheet>
        )}
      </div>
    ) : null;

  return { extraSlot, alertSlot };
}
