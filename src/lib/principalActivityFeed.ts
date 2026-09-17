import { getChildDisplayName } from "@/lib/childDisplayName";
import { getRoleLabel, type VocabularyOverrides } from "@/lib/vocabulary";
import type { InstitutionType } from "@/lib/institutionType";

// PRD 5 Stage 1. Shared by PrincipalActivityCard (dashboard preview)
// and principal/activity/page.tsx (the full feed) -- both render the
// exact same get_principal_activity_feed() row shape and both used to
// hand-copy the child-name-prefix logic; this is now the one place
// both the child-name prefix AND the role-label suffix (migration
// 0202's own actor_role, replacing the SQL-side label that was baked
// in before) are decided.
interface ActivityFeedEntry {
  event_description: string;
  child_name: string | null;
  actor_role: string | null;
}

export function formatActivityDescription(
  entry: ActivityFeedEntry,
  institutionType: InstitutionType,
  overrides: VocabularyOverrides
): string {
  let description = entry.event_description;

  if (entry.actor_role) {
    description = `${description} as ${getRoleLabel(entry.actor_role, institutionType, overrides)}`;
  }

  return entry.child_name ? `${getChildDisplayName(entry.child_name)} — ${description}` : description;
}
