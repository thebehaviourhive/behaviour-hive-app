import Link from "next/link";
import {
  ChatBubbleIcon,
  ClinicalFileIcon,
  ClipboardIcon,
  LightbulbIcon,
  OpenBookIcon,
  TrendUpIcon,
} from "@/components/ui/icons";

const ACTIONS = [
  { label: "Resources", href: "/clinician/resources", Icon: LightbulbIcon },
  { label: "Messages", href: "/clinician/messages", Icon: ChatBubbleIcon },
  { label: "View Passports", href: "/clinician/passports", Icon: OpenBookIcon },
  { label: "Add Log", href: "/clinician/log", Icon: ClipboardIcon },
  { label: "FBAs", href: "/clinician/fba", Icon: ClinicalFileIcon },
  // Stage 4 -- "Layer 2: caseload strategy insights". A quick-actions
  // tile, same as every other clinician top-level route (FBAs,
  // Passports, ...) -- ClinicianBottomNav is a hard 3-tab list
  // (Dashboard/Passports/More) with no established precedent for a 4th
  // persistent tab on this track, so this follows the existing pattern
  // rather than adding one.
  { label: "Strategy Insights", href: "/clinician/insights", Icon: TrendUpIcon },
];

export function ClinicianQuickActions() {
  return (
    <div className="mb-8 grid grid-cols-2 gap-3 px-4 mt-6">
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
