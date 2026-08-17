"use client";

import { useState, type ReactNode } from "react";
import { MessageCard } from "./MessageCard";
import { MessageCardSkeleton } from "./MessageCardSkeleton";
import type { MessageRole, ThreadMessage } from "@/types/messages";

type View = "open" | "archived";

function isOpenStatus(status: ThreadMessage["status"]): boolean {
  return status === "open" || status === "in_discussion";
}

export function MessageList({
  messages,
  currentUserId,
  nameById,
  isLoading,
  onChanged,
  childName,
  viewerRole,
  emptyOpenMessage = "No open messages.",
  emptyArchivedMessage = "Nothing archived yet.",
  footer,
}: {
  messages: ThreadMessage[];
  currentUserId: string;
  nameById: Map<string, string>;
  isLoading: boolean;
  onChanged: () => void;
  childName: string;
  viewerRole: MessageRole;
  emptyOpenMessage?: ReactNode;
  emptyArchivedMessage?: ReactNode;
  footer?: ReactNode;
}) {
  const [view, setView] = useState<View>("open");
  // Change 4: one open card at a time -- lifted here so expanding a new
  // card automatically collapses whichever one was open, which is also
  // exactly what makes batch-ack fast (expand, Acknowledge, expand the
  // next one, no extra collapse tap needed).
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null);

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
          <>
            <MessageCardSkeleton />
            <MessageCardSkeleton />
          </>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-brand-neutral-black/40">
            {view === "open" ? emptyOpenMessage : emptyArchivedMessage}
          </p>
        ) : (
          filtered.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              currentUserId={currentUserId}
              nameById={nameById}
              onChanged={onChanged}
              childName={childName}
              viewerRole={viewerRole}
              isExpanded={expandedMessageId === message.id}
              onToggleExpand={() =>
                setExpandedMessageId((current) => (current === message.id ? null : message.id))
              }
            />
          ))
        )}
      </div>

      {!isLoading && footer}
    </div>
  );
}
