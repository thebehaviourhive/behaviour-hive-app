// PRD 5 GREPPABLE HOOK POINT: this function will read a real
// `institutions.type` column once it exists. Every real institution
// today is implicitly a school -- this is the one place that
// assumption lives, so PRD 5 changes it here, not at every call site
// that currently assumes 'school'. Deliberately not backed by any
// schema change -- see CLAUDE.md's own account of why this PRD does
// not add a type column.
export type InstitutionType = "school" | "clinic";

export function getInstitutionType(_institution: { id: string }): InstitutionType {
  return "school";
}
