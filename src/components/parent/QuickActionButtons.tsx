import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ChatBubbleIcon,
  ClinicalFileIcon,
  ClipboardIcon,
  LightbulbIcon,
  OpenBookIcon,
  TrendUpIcon,
} from "@/components/ui/icons";
import { getChildFirstName } from "@/lib/childDisplayName";
import { CountBadge } from "@/components/ui/CountBadge";
import { createClient } from "@/lib/supabase/client";

// 5 tiles on the existing grid-cols-2 grid -- naturally reads as a 2x3
// layout with the 6th cell simply empty (a lone left-aligned tile in
// row 3), which is a normal, common mobile grid pattern at 375px. No
// column-count change needed to fit the 5th tile in.
//
// PRD 9, Stage 2 -- a 6th, CONDITIONAL tile, "Book a Session". Booking
// is an action a parent initiates, not a record they review -- this
// grid's own existing shape (things a parent DOES) is exactly where it
// belongs, per Daniel's own instruction. Shown only when the child has
// at least one institution-engaged clinician (PRD 9 section 4's own
// "school-engaged clinicians do not get this" scoping) -- a small,
// additional get_passport_clinicians() call, matching this same page's
// own precedent (ClinicalSupportSection already independently re-fetches
// this exact RPC rather than threading the result down as a prop).
export function QuickActionButtons({
  childName,
  messagesAwaitingCount,
  passportId,
}: {
  childName: string;
  // Change 3: replaces the old ad-hoc "N open" subtitle text with the
  // precise get_messages_awaiting_action_count() figure, rendered as a
  // corner badge instead of a line of text. null/undefined = still
  // loading / not fetched (renders no badge, same as a genuine 0).
  messagesAwaitingCount?: number | null;
  passportId?: string | null;
}) {
  const [hasBookableClinician, setHasBookableClinician] = useState(false);

  useEffect(() => {
    if (!passportId) return;
    let isMounted = true;
    createClient()
      .rpc("get_passport_clinicians", { p_passport_id: passportId })
      .then(({ data }: { data: unknown }) => {
        if (!isMounted) return;
        const rows = (data ?? []) as { engaged_by: string }[];
        setHasBookableClinician(rows.some((row) => row.engaged_by === "institution"));
      });
    return () => {
      isMounted = false;
    };
  }, [passportId]);

  const actions = [
    { label: "View Passport", href: "/passport/dashboard", Icon: OpenBookIcon },
    { label: "ABC Log", href: "/passport/dashboard?logIncident=1", Icon: ClipboardIcon },
    { label: `${getChildFirstName(childName)}'s Progress`, href: "/passport/progress", Icon: TrendUpIcon },
    { label: "Resources", href: "/resources", Icon: LightbulbIcon },
    { label: "Messages", href: "/messages", Icon: ChatBubbleIcon },
    ...(hasBookableClinician ? [{ label: "Book a Session", href: "/passport/book", Icon: ClinicalFileIcon }] : []),
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-3">
      {actions.map(({ label, href, Icon }) => (
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
