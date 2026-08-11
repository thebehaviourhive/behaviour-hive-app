// The per-send instruction line's stored text keeps the LITERAL token
// "[child name]" forever -- never resolved server-side, never baked in
// at send time -- because who's viewing it determines which name form
// is correct (parents/clinicians see the full name, teachers the
// shortened one), and the same stored row is read by all of them. Every
// renderer calls this with whichever name string its own context has
// already resolved via the existing role-aware helpers
// (getChildDisplayName for teachers, the raw name everywhere else).
export function resolveInstructionText(
  template: string | null | undefined,
  childName: string
): string | null {
  if (!template?.trim()) return null;
  return template.replaceAll("[child name]", childName);
}
