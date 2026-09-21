import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ChatBubbleIcon,
  ClinicalFileIcon,
  ClipboardIcon,
  DocumentIcon,
  LightbulbIcon,
  OpenBookIcon,
  PlusIcon,
  TrendUpIcon,
} from "@/components/ui/icons";
import { CountBadge } from "@/components/ui/CountBadge";
import { createClient } from "@/lib/supabase/client";

const ACTIONS = [
  { label: "Resources", href: "/clinician/resources", Icon: LightbulbIcon },
  { label: "Messages", href: "/clinician/messages", Icon: ChatBubbleIcon },
  { label: "View Passports", href: "/clinician/passports", Icon: OpenBookIcon },
  { label: "Add Log", href: "/clinician/log", Icon: ClipboardIcon },
  { label: "FBAs", href: "/clinician/fba", Icon: ClinicalFileIcon },
  { label: "Strategy Insights", href: "/clinician/insights", Icon: TrendUpIcon },
  // PRD 7 Stage 4 -- institution-scoped, caseload-wide, not per-child --
  // same reasoning as "FBAs" itself, not a per-passport tile.
  { label: "Strategy Bank", href: "/clinician/strategy-bank", Icon: DocumentIcon },
];

export function ClinicianQuickActions({
  messagesAwaitingCount,
  userId,
}: {
  // Change 3: sourced from get_messages_awaiting_action_count(), which is
  // entirely self-scoped (auth.uid()) -- a clinician's read-only
  // parent<->teacher viewing-only traffic can never contribute, since
  // they're neither sender nor recipient of those rows.
  messagesAwaitingCount?: number | null;
  // PRD 10 Stage 4, section 5.5 -- "a toggle letting practitioners add
  // clients, when nothing on a practitioner's screens links to adding
  // one, switches on nothing." Self-fetches whether THIS practitioner's
  // own clinic currently has practitioner_can_onboard on, via the same
  // institution_staff-join-institutions query /principal/passports/
  // enrol's own caller-resolution effect already uses -- a practitioner
  // can be staff at more than one place (a school-engaged clinician is
  // an established, real pattern), so this checks every row, not just
  // the first, and only counts a clinic row with the toggle on.
  userId?: string | null;
}) {
  const [canOnboard, setCanOnboard] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    const supabase = createClient();

    supabase
      .from("institution_staff")
      .select("role, institutions(type, practitioner_can_onboard)")
      .eq("user_id", userId)
      .eq("role", "clinician")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .then(({ data }) => {
        if (!isMounted) return;
        const rows = (data ?? []) as Array<{
          institutions: { type: string; practitioner_can_onboard: boolean } | { type: string; practitioner_can_onboard: boolean }[] | null;
        }>;
        const eligible = rows.some((row) => {
          const inst = Array.isArray(row.institutions) ? row.institutions[0] : row.institutions;
          return inst?.type === "clinic" && inst.practitioner_can_onboard;
        });
        setCanOnboard(eligible);
      });

    return () => {
      isMounted = false;
    };
  }, [userId]);

  const actions = canOnboard
    ? [...ACTIONS, { label: "Add Client", href: "/principal/passports/enrol", Icon: PlusIcon }]
    : ACTIONS;

  return (
    <div className="mb-8 grid grid-cols-2 gap-3 px-4 mt-6">
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
