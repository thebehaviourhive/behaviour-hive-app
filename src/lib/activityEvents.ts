import { differenceInHours, differenceInMinutes, format } from "date-fns";
import {
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
  | "calm_escalation";

export interface ActivityLogEntry {
  id: string;
  event_type: ActivityEventType;
  event_description: string;
  created_at: string;
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
