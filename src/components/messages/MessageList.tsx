"use client";

import { useState } from "react";
import { MessageCard } from "./MessageCard";
import type { ThreadMessage } from "@/types/messages";

type View = "open" | "archived";

// open/in_discussion = still needs someone's attention; acknowledged/
// closed = resolved. The archive toggle switches between those two
// buckets rather than showing everything at once, so a long-lived
// passport's list doesn't drown active items in old resolved ones.
function isOpenStatus(status: ThreadMessage["status"]): boolean {
  return status === "open" || status === "in_discussion";
}

export function MessageList({
  messages,
  currentUserId,
  nameById,
  isLoading,
  onChanged,
}: {
  messages: ThreadMessage[];
  currentUserId: string;
  nameById: Map<string, string>;
  isLoading: boolean;
  onChanged: () => void;
}) {
  const [view, setView] = useState<View>("open");

  // Already ascending (oldest-first) from useMessageThread -- the
  // brief's own ordering choice, so the longest-outstanding open item
  // surfaces first rather than getting buried under newer ones.
  const filtered = messages.filter((message) =>
    view === "open" ? isOpenStatus(message.status) : !isOpenStatus(message.status)
  );

  return (
    <div>
      <div className="flex gap-2">
        {(["open", "archived"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={view === option}
            onClick={() => setView(option)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              view === option
                ? "bg-brand-prussian-blue text-white"
                : "bg-black/5 text-brand-neutral-black/60"
            }`}
          >
            {option === "open" ? "Open" : "Archived"}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-brand-neutral-black/40">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-brand-neutral-black/40">
            {view === "open" ? "No open messages." : "Nothing archived yet."}
          </p>
        ) : (
          filtered.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              currentUserId={currentUserId}
              nameById={nameById}
              onChanged={onChanged}
            />
          ))
        )}
      </div>
    </div>
  );
}
