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
export function QuickActionButtons({ childName }: { childName: string }) {
  const actions = [
    { label: "View Passport", href: "/passport/dashboard", Icon: OpenBookIcon },
    { label: "ABC Log", href: "/passport/dashboard?logIncident=1", Icon: ClipboardIcon },
    { label: `${getChildFirstName(childName)}'s Progress`, href: "/passport/progress", Icon: TrendUpIcon },
    { label: "Resources", href: "/resources", Icon: LightbulbIcon },
    { label: "Messages", href: "/messages", Icon: ChatBubbleIcon },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-3">
      {actions.map(({ label, href, Icon }) => (
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
