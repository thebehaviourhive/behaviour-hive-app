import Link from "next/link";
import { ChatBubbleIcon, ClipboardIcon, LightbulbIcon, PeopleIcon } from "@/components/ui/icons";
import { CountBadge } from "@/components/ui/CountBadge";

const ACTIONS = [
  { label: "Students", href: "/teacher/students", Icon: PeopleIcon },
  { label: "ABC Log", href: "/teacher/abc-log", Icon: ClipboardIcon },
  { label: "Resources", href: "/teacher/resources", Icon: LightbulbIcon },
  { label: "Messages", href: "/teacher/messages", Icon: ChatBubbleIcon },
];

export function TeacherQuickActions({
  messagesAwaitingCount,
}: {
  // Change 3: sourced from get_messages_awaiting_action_count(), a
  // Prussian Blue corner badge on the Messages tile only.
  messagesAwaitingCount?: number | null;
}) {
  return (
    <div className="mb-6 mt-8 grid grid-cols-2 gap-3 px-4">
      {ACTIONS.map(({ label, href, Icon }) => (
        <Link
          key={label}
          href={href}
          className="relative flex flex-col items-center justify-center rounded-2xl border border-brand-off-white bg-white p-4 text-center shadow-sm transition-colors active:bg-brand-safe-ivory"
        >
          {label === "Messages" && <CountBadge count={messagesAwaitingCount} />}
          <Icon className="mb-2 h-8 w-8 text-brand-prussian-blue" />
          <span className="font-sans text-sm font-bold text-brand-neutral-black">{label}</span>
        </Link>
      ))}
    </div>
  );
}
