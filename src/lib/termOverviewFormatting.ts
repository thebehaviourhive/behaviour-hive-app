// PRD 4, Stage 6 -- Term Overview's own trend arithmetic, kept out of
// the RPC deliberately (get_institution_term_overview() returns raw
// current/prior counts; percentage, direction and copy are a
// presentation concern, computed once here rather than duplicated
// between the page and the print route).
//
// "Trends without red" (PRD 4's own rule): a falling trend is good news
// here (fewer incidents/restraints) and gets Prussian Blue; a rise is
// neutral dark grey, not alarming red -- the direction is stated in
// words ("Down 15% from last term"), colour never carries the
// judgement on its own.

export type TrendDirection = "down" | "up" | "flat" | "new";

export interface Trend {
  direction: TrendDirection;
  percent: number | null;
  label: string;
}

export function computeTrend(current: number, prior: number): Trend {
  if (prior === 0) {
    if (current === 0) {
      return { direction: "flat", percent: null, label: "No change from last term" };
    }
    return { direction: "new", percent: null, label: "New this term -- no comparable figure last term" };
  }
  const change = ((current - prior) / prior) * 100;
  const rounded = Math.round(Math.abs(change));
  if (current < prior) {
    return { direction: "down", percent: rounded, label: `Down ${rounded}% from last term` };
  }
  if (current > prior) {
    return { direction: "up", percent: rounded, label: `Up ${rounded}% from last term` };
  }
  return { direction: "flat", percent: 0, label: "No change from last term" };
}

export function formatTermDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatTermRange(start: string, end: string): string {
  return `${formatTermDate(start)} – ${formatTermDate(end)}`;
}
