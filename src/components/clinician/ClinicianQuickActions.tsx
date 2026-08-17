import Link from "next/link";
import {
  ChatBubbleIcon,
  ClinicalFileIcon,
  ClipboardIcon,
  LightbulbIcon,
  OpenBookIcon,
  TrendUpIcon,
} from "@/components/ui/icons";
import { CountBadge } from "@/components/messages/CountBadge";

const ACTIONS = [
  { label: "Resources", href: "/clinician/resources", Icon: LightbulbIcon },
  { label: "Messages", href: "/clinician/messages", Icon: ChatBubbleIcon },
  { label: "View Passports", href: "/clinician/passports", Icon: OpenBookIcon },
  { label: "Add Log", href: "/clinician/log", Icon: ClipboardIcon },
  { label: "FBAs", href: "/clinician/fba", Icon: ClinicalFileIcon },
  { label: "Strategy Insights", href: "/clinician/insights", Icon: TrendUpIcon },
];

export function ClinicianQuickActions({
  messagesAwaitingCount,
}: {
  // Change 3: sourced from get_messages_awaiting_action_count(), which is
  // entirely self-scoped (auth.uid()) -- a clinician's read-only
  // parent<->teacher viewing-only traffic can never contribute, since
  // they're neither sender nor recipient of those rows.
  messagesAwaitingCount?: number | null;
}) {
  return (
    <div className="mb-8 grid grid-cols-2 gap-3 px-4 mt-6">
      {ACTIONS.map(({ label, href, Icon }) => (
        <Link
          key={label}
          href={href}
          className="relative flex flex-col items-center justify-center rounded-2xl border border-brand-off-white/50 bg-white p-4 text-center shadow-sm transition-colors active:bg-brand-safe-ivory"
        >
          {label === "Messages" && <CountBadge count={messagesAwaitingCount} />}
          <Icon className="mb-2 h-8 w-8 text-brand-prussian-blue" />
          <span className="font-sans text-sm font-bold text-brand-neutral-black">
            {label}
          </span>
        </Link>
      ))}
    </div>
  );
}
