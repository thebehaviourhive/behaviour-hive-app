import {
  ACTIVITY_EVENT_ICON,
  formatActivityTimestamp,
  type ActivityLogEntry,
} from "@/lib/activityEvents";

export function ActivityRow({ entry }: { entry: ActivityLogEntry }) {
  const Icon = ACTIVITY_EVENT_ICON[entry.event_type];

  return (
    <div className="mb-4 flex items-start gap-3 last:mb-0">
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-pastel-blue/20 p-2 text-brand-prussian-blue">
        <Icon className="h-full w-full" />
      </span>
      <p className="flex-1 font-sans text-sm font-medium leading-tight text-brand-neutral-black">
        {entry.event_description}
      </p>
      <span className="whitespace-nowrap font-accent text-xs text-brand-neutral-black/50">
        {formatActivityTimestamp(entry.created_at)}
      </span>
    </div>
  );
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
