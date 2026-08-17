"use client";

import { useState } from "react";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { insertWithOfflineRetry } from "@/lib/waitForReconnect";
import { ROLE_LABEL, type ThreadMessage } from "@/types/messages";

type AckPhase = "idle" | "saving" | "waiting-for-connection" | "error";

const STATUS_META: Record<ThreadMessage["status"], { label: string; className: string }> = {
  open: { label: "Open", className: "bg-brand-pastel-blue/40 text-brand-prussian-blue" },
  in_discussion: { label: "In discussion", className: "bg-brand-golden-brown/15 text-brand-golden-brown" },
  acknowledged: { label: "Acknowledged", className: "bg-green-100 text-green-800" },
  closed: { label: "Closed", className: "bg-black/5 text-brand-neutral-black/50" },
};

function formatTime(iso: string): string {
  return format(new Date(iso), "d MMM, HH:mm");
}

// Shared card -- one implementation for every viewing role. What renders
// depends only on the viewer's relationship to THIS message (sender /
// recipient / neither) and its own state, never on which app track is
// hosting it. NO reply affordance ever appears unless response_required
// is set -- that's structural (constraint 1), not a style choice.
export function MessageCard({
  message,
  currentUserId,
  nameById,
  onChanged,
}: {
  message: ThreadMessage;
  currentUserId: string;
  nameById: Map<string, string>;
  onChanged: () => void;
}) {
  const isSender = message.senderId === currentUserId;
  const ownRecipient = message.recipients.find((r) => r.recipientId === currentUserId) ?? null;
  const isRecipient = ownRecipient !== null;
  const isParticipant = isSender || isRecipient;

  const [optimisticAcked, setOptimisticAcked] = useState(false);
  const [ackPhase, setAckPhase] = useState<AckPhase>("idle");

  const [replyBody, setReplyBody] = useState("");
  const [isReplying, setIsReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const [isClosing, setIsClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const senderLabel = isSender ? "You" : (nameById.get(message.senderId) ?? ROLE_LABEL[message.senderRole]);
  const status = STATUS_META[message.status];

  async function handleAcknowledge() {
    // Optimistic: the button disappears instantly, before the network
    // round-trip -- durable write happens in the background via the
    // established offline-retry pattern. A definitive (non-network)
    // failure rolls this back and surfaces an explicit Retry rather than
    // failing silently, per constraint: "a silently failed acknowledge
    // is a trust bug."
    setOptimisticAcked(true);
    const supabase = createClient();
    const result = await insertWithOfflineRetry(
      () => supabase.rpc("acknowledge_message", { p_message_id: message.id }),
      (statusPhase) => setAckPhase(statusPhase)
    );

    if (result === null) {
      setAckPhase("idle");
      onChanged();
    } else if (result !== "cancelled") {
      setOptimisticAcked(false);
      setAckPhase("error");
    }
  }

  async function handleReply() {
    if (!replyBody.trim() || isReplying) return;
    setIsReplying(true);
    setReplyError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("reply_to_message", {
      p_message_id: message.id,
      p_body: replyBody.trim(),
    });
    setIsReplying(false);
    if (error) {
      setReplyError(error.message);
      return;
    }
    setReplyBody("");
    onChanged();
  }

  async function handleClose() {
    setIsClosing(true);
    setCloseError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("close_message", { p_message_id: message.id });
    setIsClosing(false);
    if (error) {
      setCloseError(error.message);
      return;
    }
    onChanged();
  }

  const acked = Boolean(ownRecipient?.acknowledgedAt) || optimisticAcked;

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-brand-off-white px-2.5 py-1 text-xs font-semibold text-brand-neutral-black/70">
          {message.categoryLabel}
        </span>
        <div className="flex items-center gap-1.5">
          {/* The read-only rule, made visible: shown whenever the viewer
              can see this message (can_view_message) without being its
              sender or recipient -- the clinician's parent<->teacher
              mid-day signal, or a parent reading traffic they weren't
              party to. No acknowledge/reply affordance ever renders for
              them below, this badge is why. */}
          {!isParticipant && (
            <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold text-brand-neutral-black/50">
              Viewing only
            </span>
          )}
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>
            {status.label}
          </span>
        </div>
      </div>

      <p className="mt-2.5 text-sm font-semibold text-brand-neutral-black">
        {senderLabel}
        <span className="font-normal text-brand-neutral-black/40"> · {ROLE_LABEL[message.senderRole]}</span>
      </p>
      {message.body && (
        <p className="mt-1 text-sm leading-relaxed text-brand-neutral-black/80">{message.body}</p>
      )}
      <p className="mt-1.5 text-xs text-brand-neutral-black/40">{formatTime(message.createdAt)}</p>

      {/* Sender's own view: a compact delivery/ack receipt per recipient
          -- what a sender actually wants to know ("did this land?"),
          without exposing every recipient's raw row to every recipient. */}
      {isSender && message.recipients.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 border-t border-black/5 pt-3">
          {message.recipients.map((recipient) => (
            <p key={recipient.id} className="text-xs text-brand-neutral-black/50">
              {nameById.get(recipient.recipientId) ?? ROLE_LABEL[recipient.recipientRole]}:{" "}
              {recipient.acknowledgedAt ? (
                <span className="font-medium text-green-700">Acknowledged · {formatTime(recipient.acknowledgedAt)}</span>
              ) : (
                "Not yet acknowledged"
              )}
            </p>
          ))}
        </div>
      )}

      {isRecipient && !acked && message.status !== "closed" && (
        <div className="mt-3">
          <button
            type="button"
            onClick={handleAcknowledge}
            className="w-full rounded-xl bg-brand-prussian-blue py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-60"
            disabled={ackPhase === "saving" || ackPhase === "waiting-for-connection"}
          >
            {ackPhase === "saving" && "Saving…"}
            {ackPhase === "waiting-for-connection" && "Waiting for connection…"}
            {(ackPhase === "idle" || ackPhase === "error") && "Acknowledge"}
          </button>
          {ackPhase === "error" && (
            <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
              Couldn&apos;t save. Please try again.
            </p>
          )}
        </div>
      )}
      {isRecipient && acked && !isSender && (
        <p className="mt-3 text-xs font-medium text-green-700">
          You acknowledged{ownRecipient?.acknowledgedAt ? ` · ${formatTime(ownRecipient.acknowledgedAt)}` : ""}
        </p>
      )}

      {/* Reply thread: structurally absent unless response_required --
          never rendered otherwise, regardless of card/thread state. Also
          skipped for a non-participant "Viewing only" viewer when there's
          nothing to show them yet (no replies, nothing to act on) -- no
          point in an empty bordered box. */}
      {message.responseRequired && (message.replies.length > 0 || isParticipant) && (
        <div className="mt-3 border-t border-black/5 pt-3">
          {message.replies.length > 0 && (
            <div className="mb-3 flex flex-col gap-2.5">
              {message.replies.map((reply) => (
                <div key={reply.id}>
                  <p className="text-xs font-semibold text-brand-neutral-black/70">
                    {reply.authorId === currentUserId ? "You" : (nameById.get(reply.authorId) ?? "Participant")}
                    <span className="ml-1.5 font-normal text-brand-neutral-black/40">{formatTime(reply.createdAt)}</span>
                  </p>
                  <p className="text-sm text-brand-neutral-black/80">{reply.body}</p>
                </div>
              ))}
            </div>
          )}

          {message.status === "closed" ? (
            <p className="text-xs font-medium text-brand-neutral-black/40">This conversation is closed.</p>
          ) : (
            isParticipant && (
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value.slice(0, 200))}
                    placeholder="Reply…"
                    className="flex-1 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                  />
                  <button
                    type="button"
                    onClick={handleReply}
                    disabled={!replyBody.trim() || isReplying}
                    className="rounded-xl bg-brand-prussian-blue px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {isReplying ? "…" : "Send"}
                  </button>
                </div>
                {replyError && (
                  <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
                    {replyError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isClosing}
                  className="mt-2.5 text-xs font-semibold text-brand-neutral-black/50 underline underline-offset-2 disabled:opacity-50"
                >
                  {isClosing ? "Closing…" : "Close conversation"}
                </button>
                {closeError && (
                  <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
                    {closeError}
                  </p>
                )}
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}
