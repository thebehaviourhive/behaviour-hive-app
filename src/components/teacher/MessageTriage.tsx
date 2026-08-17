"use client";

import { useState } from "react";
import { MessageCard } from "@/components/messages/MessageCard";
import { MessageCardSkeleton } from "@/components/messages/MessageCardSkeleton";
import type { TriageGroup } from "@/hooks/useTeacherMessageTriage";
import type { ThreadMessage } from "@/types/messages";

type View = "open" | "archived";

function isOpenStatus(status: ThreadMessage["status"]): boolean {
  return status === "open" || status === "in_discussion";
}

// The teacher triage view: every linked pupil's messages in one list,
// grouped by child, one shared Open/Archived toggle rather than one per
// child (a teacher with a full class doesn't want to flip N toggles).
// Each card is the same shared MessageCard the parent surface uses --
// acknowledging here is the identical one-tap optimistic action, so a
// teacher genuinely can clear five messages in five taps without
// leaving this screen.
export function MessageTriage({
  groups,
  currentUserId,
  nameById,
  isLoading,
  onChanged,
}: {
  groups: TriageGroup[];
  currentUserId: string;
  nameById: Map<string, string>;
  isLoading: boolean;
  onChanged: () => void;
}) {
  const [view, setView] = useState<View>("open");

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
                    viewerRole="class_teacher"
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
