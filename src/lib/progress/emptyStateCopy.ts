import type { ProgressViewerRole } from "./types";

// Centralises every piece of empty/sparse-state copy so the "unlock
// counts must be computed live, never hardcoded" rule (constraint A3)
// has exactly one place that reads real numbers into a string -- no
// render site hand-builds this text itself.

export function zeroDataCopy(role: ProgressViewerRole, childFirstName: string): { title: string; body: string } {
  if (role === "parent") {
    return {
      title: "No data yet",
      body: `Every check-in builds ${childFirstName}'s picture. Start today and watch the trends appear.`,
    };
  }
  if (role === "teacher") {
    return {
      title: "No data yet",
      body: `Once morning check-ins and end-of-day updates start coming in for ${childFirstName}, trends will build here.`,
    };
  }
  return {
    title: "No data yet",
    body: `No check-in or EOD data recorded for ${childFirstName} yet. Trends will populate as data comes in.`,
  };
}

// unlockNeeded is the live-computed "N more days" count -- always
// passed in by the caller, never derived or guessed here.
export function sparseDataCopy(role: ProgressViewerRole, unlockNeeded: number): { title: string; body: string } {
  const dayWord = unlockNeeded === 1 ? "day" : "days";
  if (role === "parent") {
    return {
      title: "Building the picture",
      body:
        unlockNeeded > 0
          ? `${unlockNeeded} more check-in ${dayWord} unlocks your first period comparison.`
          : "Your first period comparison is ready below.",
    };
  }
  const professionalNoun = role === "teacher" ? "school days" : "logged days";
  return {
    title: "Building the picture",
    body:
      unlockNeeded > 0
        ? `${unlockNeeded} more ${professionalNoun} of data enables a period comparison.`
        : "Enough data is now logged for a period comparison.",
  };
}

export function singleSourceCopy(role: ProgressViewerRole, missing: "teacher" | "checkins"): string {
  if (missing === "teacher") {
    return role === "parent"
      ? "School data will appear here when a teacher is linked."
      : "No linked teacher data for this range yet.";
  }
  return role === "parent"
    ? "Morning check-ins will appear here once you start logging them."
    : "No morning check-in data for this range yet.";
}
