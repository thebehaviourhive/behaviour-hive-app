import Link from "next/link";
import {
  ChatBubbleIcon,
  ClipboardIcon,
  LightbulbIcon,
  OpenBookIcon,
  TrendUpIcon,
} from "@/components/ui/icons";
import { getChildFirstName } from "@/lib/childDisplayName";

// 5 tiles on the existing grid-cols-2 grid -- naturally reads as a 2x3
// layout with the 6th cell simply empty (a lone left-aligned tile in
// row 3), which is a normal, common mobile grid pattern at 375px. No
// column-count change needed to fit the 5th tile in.
export function QuickActionButtons({
  childName,
  messagesOpenCount,
}: {
  childName: string;
  // undefined = still loading / not fetched (renders no hint, same as
  // 0); the zero-urgency rule applies to every role, so this is always
  // quiet grey text, never a badge or a colour.
  messagesOpenCount?: number;
}) {
  const actions = [
    { label: "View Passport", href: "/passport/dashboard", Icon: OpenBookIcon, hint: null },
    { label: "ABC Log", href: "/passport/dashboard?logIncident=1", Icon: ClipboardIcon, hint: null },
    { label: `${getChildFirstName(childName)}'s Progress`, href: "/passport/progress", Icon: TrendUpIcon, hint: null },
    { label: "Resources", href: "/resources", Icon: LightbulbIcon, hint: null },
    {
      label: "Messages",
      href: "/messages",
      Icon: ChatBubbleIcon,
      hint: messagesOpenCount ? `${messagesOpenCount} open` : null,
    },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-3">
      {actions.map(({ label, href, Icon, hint }) => (
        <Link
          key={label}
          href={href}
          className="flex flex-col items-center justify-center rounded-2xl border border-brand-off-white/50 bg-white p-4 text-center shadow-sm transition-colors active:bg-brand-safe-ivory"
        >
          <Icon className="mb-2 h-8 w-8 text-brand-prussian-blue" />
          <span className="font-sans text-sm font-bold text-brand-neutral-black">
            {label}
          </span>
          {hint && (
            <span className="mt-0.5 font-sans text-xs text-brand-neutral-black/40">{hint}</span>
          )}
        </Link>
      ))}
    </div>
  );
}
