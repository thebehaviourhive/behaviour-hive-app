export interface PassportProgressSnapshot {
  passportStatus: "not_started" | "in_progress" | "complete" | null;
  sectionAComplete: boolean;
  sectionB: {
    okaySignals: unknown[] | null;
    hardSignals: unknown[] | null;
    hardTriggers: unknown[] | null;
    complete: boolean;
  } | null;
  sectionCComplete: boolean;
  sectionD: {
    beforeBehaviour: unknown[] | null;
    duringDistress: unknown[] | null;
    afterDistress: unknown[] | null;
    complete: boolean;
  } | null;
}

// Determines where a parent should land when continuing their child's
// passport, based on the furthest point actually saved — not just a
// binary not_started/in_progress flag. Each section table only records
// whether ITS OWN fields are filled, so "how far did they get" is
// inferred from which fields exist, in save order.
export function getPassportResumeHref(snapshot: PassportProgressSnapshot): string {
  if (!snapshot.passportStatus || snapshot.passportStatus === "not_started") {
    return "/passport/welcome";
  }

  if (snapshot.passportStatus === "complete") {
    return "/passport/dashboard";
  }

  if (!snapshot.sectionAComplete) {
    return "/passport/section-a";
  }

  if (!snapshot.sectionB?.complete) {
    if (snapshot.sectionB?.hardTriggers) return "/passport/section-b/3";
    if (snapshot.sectionB?.hardSignals) return "/passport/section-b/2";
    return "/passport/section-b/1";
  }

  if (!snapshot.sectionCComplete) {
    return "/passport/section-c";
  }

  if (!snapshot.sectionD?.complete) {
    if (snapshot.sectionD?.afterDistress) return "/passport/section-d/4";
    if (snapshot.sectionD?.duringDistress) return "/passport/section-d/3";
    if (snapshot.sectionD?.beforeBehaviour) return "/passport/section-d/2";
    return "/passport/section-d/1";
  }

  return "/passport/dashboard";
}
