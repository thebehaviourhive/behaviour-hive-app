export type RagStatus = "red" | "amber" | "green" | "grey";

export interface RagCheckin {
  regulationState: "settled" | "unsettled" | "dysregulated" | null;
  sleepQuality: "slept_through" | "woke_briefly" | "very_restless" | "barely_slept" | null;
}

export function getRagStatus(checkin: RagCheckin | null): RagStatus {
  if (!checkin) return "grey";
  if (checkin.regulationState === "dysregulated") return "red";
  if (checkin.regulationState === "unsettled" || checkin.sleepQuality === "barely_slept") {
    return "amber";
  }
  // Reaching here already guarantees sleepQuality isn't "barely_slept" —
  // the amber check above would have caught that case.
  if (checkin.regulationState === "settled") {
    return "green";
  }
  return "grey";
}

export const RAG_TIER_ORDER: Record<RagStatus, number> = {
  red: 0,
  amber: 1,
  green: 2,
  grey: 3,
};

export const RAG_BADGE: Record<
  RagStatus,
  { label: string; dotClass: string; badgeClass: string; borderClass: string }
> = {
  red: {
    label: "Proceed with care",
    dotClass: "bg-red-500",
    badgeClass: "bg-red-50 text-red-800",
    borderClass: "border-red-500",
  },
  amber: {
    label: "Worth an early check-in",
    dotClass: "bg-amber-500",
    badgeClass: "bg-amber-50 text-amber-800",
    borderClass: "border-amber-500",
  },
  green: {
    label: "Good morning reported",
    dotClass: "bg-green-500",
    badgeClass: "bg-green-50 text-green-800",
    borderClass: "border-green-500",
  },
  grey: {
    label: "No check-in received",
    dotClass: "bg-black/30",
    badgeClass: "bg-black/5 text-black/50",
    borderClass: "border-black/15",
  },
};
