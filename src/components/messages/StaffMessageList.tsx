"use client";

import { useState } from "react";
import { MessageCard } from "@/components/messages/MessageCard";
import { MessageCardSkeleton } from "@/components/messages/MessageCardSkeleton";
import { isOpenStatus } from "@/lib/messages/messageStatus";
import type { MessageRole, ThreadMessage } from "@/types/messages";

type View = "open" | "archived";

// Staff-to-staff messaging, small version -- deliberately the flat
// sibling of MessageTriage.tsx, not that component reused. A school's
// staff list is a handful of colleagues, not the dozens of children the
// per-child triage groups by, so there's no grouping heading here at
// all, just the same Open/Archived toggle and one-card-expanded-at-a-
// time behaviour every other message surface already has.
export function StaffMessageList({
  messages,
  currentUserId,
  nameById,
  isLoading,
  onChanged,
  viewerRole,
}: {
  messages: ThreadMessage[];
  currentUserId: string;
  nameById: Map<string, string>;
  isLoading: boolean;
  onChanged: () => void;
  viewerRole: MessageRole;
}) {
  const [view, setView] = useState<View>("open");
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null);

  const visibleMessages = messages.filter((m) => (view === "open" ? isOpenStatus(m.status) : !isOpenStatus(m.status)));

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
        ) : visibleMessages.length === 0 ? (
          <p className="py-8 text-center text-sm text-brand-neutral-black/40">
            {view === "open" ? "No open staff conversations." : "Nothing archived yet."}
          </p>
        ) : (
          visibleMessages.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              currentUserId={currentUserId}
              nameById={nameById}
              onChanged={onChanged}
              // No child in play -- the {{childName}} token is never
              // written into a staff message body, so an empty string
              // is a safe, unused substitution target.
              childName=""
              viewerRole={viewerRole}
              isExpanded={expandedMessageId === message.id}
              onToggleExpand={() =>
                setExpandedMessageId((current) => (current === message.id ? null : message.id))
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
