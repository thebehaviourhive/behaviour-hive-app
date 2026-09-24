import { differenceInHours, differenceInMinutes, format } from "date-fns";
import { HandHelping } from "lucide-react";
import type { JSX } from "react";
import {
  AlertTriangleIcon,
  BellIcon,
  CheckIcon,
  ClinicalFileIcon,
  ClipboardIcon,
  DocumentIcon,
  KeyIcon,
  LightbulbIcon,
  LockIcon,
  PeopleIcon,
} from "@/components/ui/icons";

export type ActivityEventType =
  | "passport_updated"
  | "morning_checkin"
  | "afternoon_update"
  | "abc_logged"
  | "passport_shared"
  | "team_linked"
  | "clinician_logged"
  | "strategy_logged"
  | "access_revoked"
  | "fba_started"
  | "fba_completed"
  | "clinical_content_added"
  | "questionnaire_sent"
  | "questionnaire_completed"
  | "calm_escalation"
  // Migration 0152 -- incidents interleaved into the parent, teacher,
  // and clinician activity feeds (never activity_log itself; a
  // synthetic event_type produced by the feed RPCs' own UNION). Not
  // principal, not SNA -- see that migration's own header for why both
  // are parked, not just not-yet-built.
  | "incident"
  // Migration 0155 -- Support Button presses, teacher track only for
  // now (institution-wide audience, not per-child -- passport_id/
  // child_name are null on these rows). Principal side deliberately
  // not built here; depends on how that track's own activity container
  // ends up scoped, reported separately.
  | "support_alert"
  // Migration 0171 -- the principal activity feed's staff half (joins,
  // leaves, rejections, handovers, temporary access grants). Principal
  // track only -- none of these are per-child, so none of the other
  // tracks' own feeds ever produce them. The per-child half stays
  // deliberately unbuilt; see CLAUDE.md's own "PRINCIPAL ACTIVITY FEED
  // -- PER-CHILD EVENTS, OPEN" entry for why.
  | "staff_joined"
  | "staff_deactivated"
  | "staff_join_rejected"
  | "principal_handover"
  | "temporary_access_grant"
  // Migration 0228 -- session_notes' own share/edit-after-share
  // tracking trigger. Same shape as clinical_content_added: the feed
  // says something arrived or changed, the passport
  // (SharedSessionNotesSection, passport/dashboard) is where you read
  // it. No href on either -- non-linking rows, matching that precedent.
  | "session_note_shared"
  | "session_note_updated"
  // Migration 0297 -- PRD 11 Stage 3's own "the parent is told, not
  // asked" mechanism: redeem_institution_link_code()'s respite branch
  // writes this the moment a centre redeems a link code, and it reaches
  // a parent's own feed automatically (get_parent_activity_feed()'s
  // exclusion list is a denylist, confirmed by reading it directly --
  // nothing needed to add it there). A genuinely new type rather than
  // reusing team_linked -- that one is clinician-facing by convention
  // (get_clinician_activity_feed()'s own allow-list already includes
  // it); this one has no clinician audience to reach, only a parent's.
  | "respite_centre_linked";

export interface ActivityLogEntry {
  id: string;
  event_type: ActivityEventType;
  event_description: string;
  created_at: string;
  // Present (non-null) only on event_type "incident" -- the real
  // incidents.id, for linking to that track's own incident detail
  // surface. Every other event type leaves this null/undefined.
  incident_id?: string | null;
}

// Thin wrapper -- lucide-react's own component type returns ReactNode,
// not the JSX.Element the rest of this Record's function signature
// requires (icons.tsx's hand-drawn set all return one directly). Same
// underlying icon, just typed to match.
function SupportAlertIcon(props: { className?: string }): JSX.Element {
  return <HandHelping {...props} aria-hidden />;
}

export const ACTIVITY_EVENT_ICON: Record<
  ActivityEventType,
  (props: { className?: string }) => React.JSX.Element
> = {
  passport_updated: DocumentIcon,
  morning_checkin: CheckIcon,
  afternoon_update: BellIcon,
  abc_logged: ClipboardIcon,
  passport_shared: KeyIcon,
  team_linked: PeopleIcon,
  clinician_logged: ClinicalFileIcon,
  strategy_logged: LightbulbIcon,
  access_revoked: LockIcon,
  fba_started: ClinicalFileIcon,
  fba_completed: ClinicalFileIcon,
  clinical_content_added: LightbulbIcon,
  session_note_shared: ClinicalFileIcon,
  session_note_updated: ClinicalFileIcon,
  // Clinician-feed-only (see the visibility matrix in migration 0049) --
  // never rendered on the parent or teacher tracks, but still needs an
  // icon since ACTIVITY_EVENT_ICON is a Record over every event type.
  questionnaire_sent: ClipboardIcon,
  questionnaire_completed: ClipboardIcon,
  // Clinician-feed-only, same as above -- excluded from the parent's
  // own activity_log visibility (migration 0054) since "the parent is
  // NOT shown that the notice fired" applies to the ordinary feed too,
  // not just the dedicated red card (CalmEscalationNoticeList).
  calm_escalation: ClinicalFileIcon,
  // Migration 0152 -- same icon the Incidents bottom-nav tab already
  // uses, for visual consistency between "this is an incident" here and
  // everywhere else it's marked that way in the app.
  incident: AlertTriangleIcon,
  // Migration 0155 -- same icon the Support Button's own nav pill uses
  // (useSupportButtonNavSlots.tsx), imported raw from lucide-react like
  // that file already does -- this feature already deviates from the
  // hand-drawn icons.tsx house style there, not a new inconsistency.
  support_alert: SupportAlertIcon,
  // Migration 0171 -- reusing existing icons rather than adding new
  // ones: PeopleIcon already means "a roster/team change" (team_linked);
  // LockIcon already means "access changed" (access_revoked); KeyIcon
  // already means "access granted/transferred" (passport_shared).
  staff_joined: PeopleIcon,
  staff_deactivated: LockIcon,
  staff_join_rejected: LockIcon,
  principal_handover: KeyIcon,
  temporary_access_grant: KeyIcon,
  // Migration 0297 -- same "a roster/team change" reading team_linked
  // already uses this icon for.
  respite_centre_linked: PeopleIcon,
};

export function formatActivityTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const hours = differenceInHours(now, date);

  if (hours < 24) {
    const minutes = Math.max(0, differenceInMinutes(now, date));
    if (minutes < 60) return `${Math.max(1, minutes)} mins ago`;
    return `${hours} hr ago`;
  }

  return format(date, "dd/MM/yy");
}
