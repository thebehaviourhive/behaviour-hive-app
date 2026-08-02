import Link from "next/link";
import {
  ChatBubbleIcon,
  ClipboardIcon,
  LightbulbIcon,
  OpenBookIcon,
} from "@/components/ui/icons";

const ACTIONS = [
  { label: "View Passport", href: "/passport/dashboard", Icon: OpenBookIcon },
  { label: "ABC Log", href: "/passport/dashboard?logIncident=1", Icon: ClipboardIcon },
  { label: "Resources", href: "/resources", Icon: LightbulbIcon },
  { label: "Messages", href: "/messages", Icon: ChatBubbleIcon },
];

export function QuickActionButtons() {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3">
      {ACTIONS.map(({ label, href, Icon }) => (
        <Link
          key={label}
          href={href}
          className="flex flex-col items-center justify-center rounded-2xl border border-brand-off-white/50 bg-white p-4 text-center shadow-sm transition-colors active:bg-brand-safe-ivory"
        >
          <Icon className="mb-2 h-8 w-8 text-brand-prussian-blue" />
          <span className="font-sans text-sm font-bold text-brand-neutral-black">
            {label}
          </span>
        </Link>
      ))}
    </div>
  );
}
