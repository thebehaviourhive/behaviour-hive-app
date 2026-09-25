"use client";

import { useState } from "react";
import { WorkQueueRow, type WorkQueueRowProps } from "@/components/shared/WorkQueueRow";
import { SnoozeSheet } from "@/components/shared/SnoozeSheet";
import type { SnoozeMeta } from "@/hooks/useOutstandingTaskSnoozes";

// Outstanding-task snoozing, 25 Sept 2026. A drop-in replacement for
// WorkQueueRow -- same props, plus the snooze-specific ones -- rather
// than modifying WorkQueueRow itself. WorkQueueRow is shared by every
// dashboard in the product and heavily depended on as-is; wrapping it
// here means every existing caller that hasn't been touched keeps
// working exactly as it did, and every caller that adopts snoozing
// does so by swapping the import, not by learning a new component.
//
// REPEATED SNOOZING IS A SIGNAL, per the brief: "after three, the
// queue should say so." Chosen presentation, since the brief asked to
// be told what was chosen rather than left to guess: a Golden Brown
// line UNDER the row (this app's own attention colour, never the
// reserved Support Button red), shown only once an item has come BACK
// off a snooze with a count of three or more -- not while it's still
// actively snoozed (nobody's looking at it then) and not at one or two
// snoozes (a single legitimate "still not ready" is not yet a pattern
// worth calling out). This is a visible fact, not a block -- nothing
// stops a fourth snooze; the brief never asked for that, only that the
// queue "say so".
const REPEAT_SNOOZE_THRESHOLD = 3;

export interface SnoozableWorkQueueRowProps extends WorkQueueRowProps {
  institutionId: string;
  queueKey: string;
  itemId: string;
  defaultSnoozeDays: number;
  snoozeMeta: SnoozeMeta | undefined;
  onSnoozed: () => void;
}

export function SnoozableWorkQueueRow({
  institutionId,
  queueKey,
  itemId,
  defaultSnoozeDays,
  snoozeMeta,
  onSnoozed,
  entity,
  exception,
  ...rowProps
}: SnoozableWorkQueueRowProps) {
  const [isSnoozeOpen, setIsSnoozeOpen] = useState(false);

  const isCurrentlySnoozed = Boolean(snoozeMeta?.isCurrentlySnoozed);
  const showRepeatWarning = !isCurrentlySnoozed && (snoozeMeta?.snoozeCount ?? 0) >= REPEAT_SNOOZE_THRESHOLD;

  // Appended to the row's own Exception text when the item is currently
  // snoozed -- only ever renders at all when a caller has passed
  // showSnoozed through to include it in the first place (the default,
  // unsnoozed view never reaches this branch, since the item is
  // filtered out of the list before it ever gets here).
  const decoratedException = isCurrentlySnoozed
    ? `${exception} · Snoozed until ${new Date(snoozeMeta!.snoozedUntil).toLocaleDateString()} (${
        snoozeMeta!.snoozeCount
      }x)`
    : exception;

  return (
    <div>
      <WorkQueueRow entity={entity} exception={decoratedException} {...rowProps} />
      {showRepeatWarning && (
        <p className="mt-1 px-1 font-sans text-eyebrow font-semibold text-brand-golden-brown">
          Snoozed {snoozeMeta!.snoozeCount} times — nobody has acted on this yet.
        </p>
      )}
      <button
        type="button"
        onClick={() => setIsSnoozeOpen(true)}
        className="mt-1 px-1 font-sans text-eyebrow font-semibold text-brand-neutral-black/40 underline underline-offset-2"
      >
        {isCurrentlySnoozed ? "Snooze again" : "Snooze"}
      </button>

      <SnoozeSheet
        isOpen={isSnoozeOpen}
        onClose={() => setIsSnoozeOpen(false)}
        institutionId={institutionId}
        queueKey={queueKey}
        itemId={itemId}
        itemLabel={entity}
        defaultDays={defaultSnoozeDays}
        onSnoozed={onSnoozed}
      />
    </div>
  );
}
