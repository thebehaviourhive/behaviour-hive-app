"use client";

import { useState } from "react";
import { MessageCard } from "@/components/messages/MessageCard";
import { MessageCardSkeleton } from "@/components/messages/MessageCardSkeleton";
import type { TriageGroup } from "@/hooks/useMessageTriage";
import type { MessageRole, ThreadMessage } from "@/types/messages";

type View = "open" | "archived";

function isOpenStatus(status: ThreadMessage["status"]): boolean {
  return status === "open" || status === "in_discussion";
}

// The cross-caseload triage view -- shared by the teacher track (Stage 2)
// and the clinician track (Change 1). viewerRole is the one thing that
// differs per caller: it's what lets MessageCard tell "my own traffic"
// apart from "viewing only" rows within the very same group (a clinician
// group can contain both; a teacher group never does, since a teacher's
// RLS-visible rows are only ever their own sent/received messages).
export function MessageTriage({
  groups,
  currentUserId,
  nameById,
  isLoading,
  onChanged,
  viewerRole,
}: {
  groups: TriageGroup[];
  currentUserId: string;
  nameById: Map<string, string>;
  isLoading: boolean;
  onChanged: () => void;
  viewerRole: MessageRole;
}) {
  const [view, setView] = useState<View>("open");
  // Change 4: one open card at a time across the WHOLE triage view (not
  // per group) -- expanding a card in one child's group collapses
  // whichever card was open, even if it was in a different group.
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null);

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      messages: group.messages.filter((m) => (view === "open" ? isOpenStatus(m.status) : !isOpenStatus(m.status))),
    }))
    .filter((group) => group.messages.length > 0);

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

      <div className="mt-3 flex flex-col gap-5">
        {isLoading ? (
          <>
            <MessageCardSkeleton />
            <MessageCardSkeleton />
          </>
        ) : visibleGroups.length === 0 ? (
          <p className="py-8 text-center text-sm text-brand-neutral-black/40">
            {view === "open" ? "No open messages." : "Nothing archived yet."}
          </p>
        ) : (
          visibleGroups.map((group) => (
            <div key={group.passportId}>
              <p className="mb-2 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                {group.displayName}
              </p>
              <div className="flex flex-col gap-3">
                {group.messages.map((message) => (
                  <MessageCard
                    key={message.id}
                    message={message}
                    currentUserId={currentUserId}
                    nameById={nameById}
                    onChanged={onChanged}
                    childName={group.displayName}
                    viewerRole={viewerRole}
                    isExpanded={expandedMessageId === message.id}
                    onToggleExpand={() =>
                      setExpandedMessageId((current) => (current === message.id ? null : message.id))
                    }
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
