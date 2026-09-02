import Link from "next/link";
import type { ReactNode } from "react";
import {
  ACTIVITY_EVENT_ICON,
  formatActivityTimestamp,
  type ActivityLogEntry,
} from "@/lib/activityEvents";

// Shared across parent/teacher/clinician -- migration 0152 added
// incidents into all three feeds, each linking to that track's own
// incident detail surface (a different URL shape per track, so the
// CALLER computes href, not this component). Non-incident rows pass no
// href and render exactly as before -- a plain div, not a Link.
export function ActivityRow({ entry, href }: { entry: ActivityLogEntry; href?: string }) {
  const Icon = ACTIVITY_EVENT_ICON[entry.event_type];
  const isIncident = entry.event_type === "incident";

  const content: ReactNode = (
    <>
      <span
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full p-2 ${
          isIncident ? "bg-brand-golden-brown/20 text-brand-golden-brown" : "bg-brand-pastel-blue/20 text-brand-prussian-blue"
        }`}
      >
        <Icon className="h-full w-full" />
      </span>
      <p className="flex-1 font-sans text-sm font-medium leading-tight text-brand-neutral-black">
        {entry.event_description}
      </p>
      <span className="whitespace-nowrap font-accent text-xs text-brand-neutral-black/50">
        {formatActivityTimestamp(entry.created_at)}
      </span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className="mb-4 flex items-start gap-3 last:mb-0">
        {content}
      </Link>
    );
  }

  return <div className="mb-4 flex items-start gap-3 last:mb-0">{content}</div>;
}

export function ActivityRowSkeleton() {
  return (
    <div className="mb-4 flex animate-pulse items-start gap-3 last:mb-0">
      <span className="h-8 w-8 flex-shrink-0 rounded-full bg-brand-off-white" />
      <span className="h-4 flex-1 rounded bg-brand-off-white" />
      <span className="h-3 w-12 flex-shrink-0 rounded bg-brand-off-white" />
    </div>
  );
}
