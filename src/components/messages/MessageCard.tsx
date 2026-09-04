"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { insertWithOfflineRetry } from "@/lib/waitForReconnect";
import { renderMessageBody } from "@/lib/messages/messageBodyTokens";
import { ROLE_LABEL, type MessageRecipient, type MessageRole, type ThreadMessage } from "@/types/messages";
import { AbcLogReference } from "./AbcLogReference";

type AckPhase = "idle" | "saving" | "waiting-for-connection" | "error";

const STATUS_META: Record<ThreadMessage["status"], { label: string; className: string; dotClassName: string }> = {
  open: { label: "Open", className: "bg-brand-pastel-blue/40 text-brand-prussian-blue", dotClassName: "bg-brand-prussian-blue" },
  in_discussion: {
    label: "In discussion",
    className: "bg-brand-golden-brown/15 text-brand-golden-brown",
    dotClassName: "bg-brand-golden-brown",
  },
  acknowledged: { label: "Acknowledged", className: "bg-green-100 text-green-800", dotClassName: "bg-green-600" },
  closed: { label: "Closed", className: "bg-black/5 text-brand-neutral-black/50", dotClassName: "bg-black/25" },
};

const PREVIEW_MAX = 40;

function formatTime(iso: string): string {
  return format(new Date(iso), "d MMM, HH:mm");
}

// The compact row's body preview -- first ~40 chars, single line, own
// ellipsis (not CSS truncate) so it reads the same whether the
// surrounding row happens to have more or less room.
function previewBody(body: string | null): string | null {
  if (!body) return null;
  const collapsed = body.trim();
  if (collapsed.length <= PREVIEW_MAX) return collapsed;
  return `${collapsed.slice(0, PREVIEW_MAX).trimEnd()}…`;
}

// Teacher's own scoped Clinical Team tab is keyed "clinicalTeam" on all
// three passport pages (parent's is a dashboard section, not a route of
// its own, so it gets the hash convention instead) -- never a wider
// view, never the FBA itself.
function buildStrategyHref(viewerRole: MessageRole, passportId: string): string {
  if (viewerRole === "parent") return "/passport/dashboard#clinical-team";
  if (viewerRole === "class_teacher") return `/teacher/passport/${passportId}?tab=clinicalTeam`;
  return `/clinician/passport/${passportId}?tab=clinicalTeam`;
}

// The Stage 3B payoff, generalized (Part 1 refinements): "✓ Sarah Murphy
// · Aoife Ryan (not yet)" -- one compact line, originally built just for
// clinician strategy-update sends, now reused for every multi-recipient
// message so a partially-acknowledged thread explains itself on the
// sender's own expanded card without them needing to parse a
// per-recipient list.
function formatRecipientReceipt(recipients: MessageRecipient[], nameById: Map<string, string>): string {
  return recipients
    .map((recipient) => {
      const name = nameById.get(recipient.recipientId) ?? ROLE_LABEL[recipient.recipientRole];
      return recipient.acknowledgedAt ? `✓ ${name}` : `${name} (not yet)`;
    })
    .join(" · ");
}

// Shared card -- one implementation for every viewing role. What renders
// depends only on the viewer's relationship to THIS message (sender /
// recipient / neither) and its own state, never on which app track is
// hosting it. NO reply affordance ever appears unless response_required
// is set -- that's structural (constraint 1), not a style choice.
//
// Change 4: compact by default -- a single tappable summary row (category
// chip · sender + role · ~40-char body preview · timestamp · status
// glyph), with everything below (full body, log/strategy references,
// receipts, actions, reply thread) revealed only once expanded. Expand
// state is owned by the caller (MessageList/MessageTriage), not this
// component -- that's what makes "one open at a time" and batch-ack speed
// possible without this card knowing about its siblings.
export function MessageCard({
  message,
  currentUserId,
  nameById,
  onChanged,
  childName,
  viewerRole,
  isExpanded,
  onToggleExpand,
}: {
  message: ThreadMessage;
  currentUserId: string;
  nameById: Map<string, string>;
  onChanged: () => void;
  // The viewer's own display-rules form of the child's name (redacted
  // for teachers, full for parent/clinician) -- used only to render the
  // {{childName}} token in an auto-generated body (see
  // messageBodyTokens.ts), never to widen what this card shows.
  childName: string;
  // Which track is hosting this card -- decides where "View log" /
  // "View strategies" point (each role's OWN scoped surface), nothing
  // else.
  viewerRole: MessageRole;
  isExpanded: boolean;
  onToggleExpand: () => void;
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
  const bodyPreview = previewBody(message.body ? renderMessageBody(message.body, childName) : null);

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
    <div className="rounded-2xl border border-black/5 bg-white shadow-sm">
      {/* Compact summary row -- always visible, the entire card's tap
          target for expand/collapse. Deliberately just text + a status
          dot, no nested interactive elements, so it can safely be a
          single <button>. */}
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <span aria-hidden className={`h-2 w-2 flex-shrink-0 rounded-full ${status.dotClassName}`} />
        <span className="flex-shrink-0 rounded-full bg-brand-off-white px-2 py-0.5 text-[10px] font-semibold text-brand-neutral-black/70">
          {message.categoryLabel}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-brand-neutral-black/70">
          <span className="font-semibold text-brand-neutral-black">{senderLabel}</span>
          <span className="text-brand-neutral-black/40"> · {ROLE_LABEL[message.senderRole]}</span>
          {bodyPreview && <span className="text-brand-neutral-black/50"> — {bodyPreview}</span>}
        </span>
        <span className="flex-shrink-0 text-[10px] text-brand-neutral-black/40">{formatTime(message.createdAt)}</span>
        <span className="sr-only">{status.label}{!isParticipant ? ", viewing only" : ""}</span>
      </button>

      {isExpanded && (
        <div className="border-t border-black/5 px-4 pb-4 pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-full bg-brand-off-white px-2.5 py-1 text-xs font-semibold text-brand-neutral-black/70">
              {message.categoryLabel}
            </span>
            <div className="flex items-center gap-1.5">
              {/* The read-only rule, made visible: shown whenever the
                  viewer can see this message (can_view_message) without
                  being its sender or recipient -- the clinician's
                  parent<->teacher mid-day signal, or a parent reading
                  traffic they weren't party to. No acknowledge/reply
                  affordance ever renders for them below, this badge is
                  why. */}
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
            <p className="mt-1 text-sm leading-relaxed text-brand-neutral-black/80">
              {renderMessageBody(message.body, childName)}
            </p>
          )}
          <p className="mt-1.5 text-xs text-brand-neutral-black/40">{formatTime(message.createdAt)}</p>

          {/* Stage 3A: reuses the viewer's own existing scoped log view --
              never renders any log content itself. message.passportId
              guard is belt-and-suspenders here, not load-bearing --
              send_message() (0168) refuses abcLogId on a staff thread
              outright, so a null passportId and a set abcLogId can
              never actually co-occur. */}
          {message.abcLogId && message.passportId && (
            <AbcLogReference passportId={message.passportId} abcLogId={message.abcLogId} viewerRole={viewerRole} />
          )}
          {/* Stage 3B: same principle -- links to the viewer's own scoped
              Clinical Team surface, never a wider view, never the FBA.
              Same belt-and-suspenders note as above -- strategyUpdate
              can't be true on a staff thread either. */}
          {message.strategyUpdate && message.passportId && (
            <Link
              href={buildStrategyHref(viewerRole, message.passportId)}
              className="mt-2 inline-block text-xs font-semibold text-brand-prussian-blue underline underline-offset-2"
            >
              View strategies
            </Link>
          )}

          {/* Sender's own view: a compact delivery/ack receipt per
              recipient -- what a sender actually wants to know ("did this
              land?"), without exposing every recipient's raw row to every
              recipient. Multi-recipient sends (strategy updates always
              were; Part 1 refinements extends this to every multi-
              recipient message) get the compact "✓ Name · Name (not yet)"
              line so a partially-acknowledged thread explains itself at a
              glance -- purely informational either way, never a nudge to
              chase anyone. A single recipient keeps the fuller
              name+timestamp line below; there's no "partial" state to
              summarise for just one person. */}
          {isSender && message.recipients.length > 0 && (
            <div className="mt-3 border-t border-black/5 pt-3">
              {message.strategyUpdate || message.recipients.length > 1 ? (
                <p className="text-xs text-brand-neutral-black/60">
                  {formatRecipientReceipt(message.recipients, nameById)}
                </p>
              ) : (
                <div className="flex flex-col gap-1">
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
              never rendered otherwise, regardless of card/thread state.
              Also skipped for a non-participant "Viewing only" viewer
              when there's nothing to show them yet (no replies, nothing
              to act on) -- no point in an empty bordered box. */}
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
                    {/* Sender-only: the person who requested the exchange
                        decides when it's resolved. A recipient keeps
                        Reply but sees no Close affordance at all --
                        close_message's own server-side check enforces
                        this too, so this is UI-level tidiness, not the
                        actual boundary. */}
                    {isSender && (
                      <>
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
                    )}
                  </>
                )
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
