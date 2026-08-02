import { differenceInHours, differenceInMinutes, format } from "date-fns";
import {
  BellIcon,
  CheckIcon,
  ClipboardIcon,
  DocumentIcon,
  KeyIcon,
  PeopleIcon,
} from "@/components/ui/icons";

export type ActivityEventType =
  | "passport_updated"
  | "morning_checkin"
  | "afternoon_update"
  | "abc_logged"
  | "passport_shared"
  | "team_linked";

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
