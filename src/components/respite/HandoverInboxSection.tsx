"use client";

import { InlineErrorState } from "@/components/ui/InlineErrorState";
import type { HandoverGroup, HandoverMessage } from "@/hooks/useHandoverInbox";

// Respite UI Stage 2b -- the Messages screen's own body. Grouped by
// child (see useHandoverInbox's own header for why), unread groups
// first -- "make unread the thing the eye lands on." Each group shows
// up to PREVIEW_LIMIT recent rows by name; the rest are a plain count,
// same "cap it, don't wall it" posture Stage 2a's Today/Coming-and-
// going blocks already established, extended here to a per-child
// group rather than the whole list.
const PREVIEW_LIMIT = 3;

// Same unread visual idiom MessageCard.tsx already uses -- a small
// Golden Brown dot, bold sender name -- reused rather than invented
// fresh, so an unread handover reads the same way an unread message
// already does everywhere else in this app.
function HandoverRow({ message, onOpen }: { message: HandoverMessage; onOpen: () => void }) {
  const preview = (message.body ?? "").trim().slice(0, 80);
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-start gap-2 py-2 text-left">
      {!message.isRead && (
        <span aria-hidden className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-brand-golden-brown" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-brand-neutral-black/50">
          <span className={!message.isRead ? "font-bold text-brand-neutral-black" : "font-medium"}>
            {message.senderName ?? "A colleague"}
          </span>{" "}
          ·{" "}
          {new Date(message.createdAt).toLocaleString(undefined, {
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        {preview && <span className="block truncate text-sm text-brand-neutral-black/70">{preview}</span>}
      </span>
      <span className="sr-only">{!message.isRead ? "Unread" : ""}</span>
    </button>
  );
}

function GroupCard({ group, onOpenMessage }: { group: HandoverGroup; onOpenMessage: (m: HandoverMessage) => void }) {
  const shown = group.messages.slice(0, PREVIEW_LIMIT);
  const remaining = group.messages.length - shown.length;
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${
        group.unreadCount > 0 ? "border-brand-golden-brown/20 bg-brand-golden-brown/[0.04]" : "border-black/5 bg-white"
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="font-semibold text-brand-neutral-black">{group.childName}</p>
        {group.unreadCount > 0 && (
          <span className="flex-shrink-0 rounded-full bg-brand-golden-brown px-2 py-0.5 text-xs font-semibold text-white">
            {group.unreadCount} unread
          </span>
        )}
      </div>
      <div className="divide-y divide-black/5">
        {shown.map((m) => (
          <HandoverRow key={m.messageId} message={m} onOpen={() => onOpenMessage(m)} />
        ))}
      </div>
      {remaining > 0 && <p className="pt-1 text-xs text-black/40">+{remaining} more for {group.childName}</p>}
    </div>
  );
}

export function HandoverInboxSection({
  groups,
  isLoading,
  loadError,
  onRetry,
  onOpenMessage,
}: {
  groups: HandoverGroup[];
  isLoading: boolean;
  loadError: string | null;
  onRetry: () => void;
  onOpenMessage: (message: HandoverMessage) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  // Baseline audit, 26 Sept 2026 -- was plain red text, no retry, the
  // one outlier against every other list screen in the app.
  if (loadError) {
    return <InlineErrorState message={loadError} onRetry={onRetry} />;
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
        No handovers for children currently on-site.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <GroupCard key={group.passportId} group={group} onOpenMessage={onOpenMessage} />
      ))}
    </div>
  );
}
