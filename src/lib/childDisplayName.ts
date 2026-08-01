// Teachers must never see a child's full surname — first name and last
// initial only (e.g. "Sammy T."), derived from the single free-text
// child_name field parents fill in on the passport.
export function getChildDisplayName(childName: string | null | undefined): string {
  if (!childName) return "This child";
  const parts = childName.trim().split(/\s+/);
  const first = parts[0];
  if (parts.length === 1) return first;
  const lastInitial = parts[parts.length - 1][0];
  return `${first} ${lastInitial.toUpperCase()}.`;
}

export function getChildFirstName(childName: string | null | undefined): string {
  if (!childName) return "This child";
  return childName.trim().split(/\s+/)[0];
}
