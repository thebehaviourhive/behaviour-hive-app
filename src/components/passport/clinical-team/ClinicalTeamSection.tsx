import { format } from "date-fns";
import { formatClinicianReference } from "@/lib/clinicianDisplayName";
import { SOURCE_DOCUMENT_LABELS, type ClinicalContentItem } from "@/lib/passportClinicalContent";

export type ClinicalTeamViewerRole = "parent" | "teacher" | "clinician";

function AttributionLine({
  item,
  viewerRole,
}: {
  item: ClinicalContentItem;
  viewerRole: ClinicalTeamViewerRole;
}) {
  // Every author here is a clinician (the table's only writer is
  // approve_fba_strategies, always author_role = 'clinician') -- the
  // formal "[Full name], [Specialty]" reference is correct for both
  // tracks below; there's no repeat-mention case on this surface, each
  // item card shows its own attribution once. Specialty is a
  // professional credential, not clinical/diagnostic information about
  // the child, so surfacing it to teachers alongside the name they
  // already see here leaks nothing new.
  const authorReference = item.authorName
    ? formatClinicianReference(item.authorName, item.authorSpecialty)
    : "Your Clinical Team";

  // Confirmed decision: teachers get name (+ specialty) only -- no
  // source label, no date, nothing that points toward the underlying
  // document existing.
  if (viewerRole === "teacher") {
    return <p className="mt-1.5 text-xs text-brand-neutral-black/40">From {authorReference}</p>;
  }

  const sourceLabel = SOURCE_DOCUMENT_LABELS[item.sourceDocumentType] ?? "Clinical Record";
  return (
    <p className="mt-1.5 text-xs text-brand-neutral-black/40">
      From {sourceLabel} · {authorReference} · {format(new Date(item.createdAt), "d MMM yyyy")}
    </p>
  );
}

function ItemCard({
  item,
  viewerRole,
  index,
}: {
  item: ClinicalContentItem;
  viewerRole: ClinicalTeamViewerRole;
  index?: number;
}) {
  // Strategy descriptions are newline-joined bullet lists (see
  // approve_fba_strategies' extraction) -- rendered back out as a list
  // when there's more than one line, plain text otherwise.
  const lines = item.description.split("\n").filter((line) => line.trim());

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="font-semibold text-brand-neutral-black">
        {index !== undefined ? `${index + 1}. ` : ""}
        {item.title || "Untitled"}
      </p>
      {lines.length > 1 ? (
        <ul className="mt-1 list-disc pl-5 text-sm text-brand-neutral-black/70">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        lines[0] && <p className="mt-1 text-sm text-brand-neutral-black/70">{lines[0]}</p>
      )}
      <AttributionLine item={item} viewerRole={viewerRole} />
    </div>
  );
}

function Group({
  title,
  items,
  viewerRole,
  numbered,
}: {
  title: string;
  items: ClinicalContentItem[];
  viewerRole: ClinicalTeamViewerRole;
  numbered?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-brand-neutral-black">{title}</p>
      <div className="flex flex-col gap-2">
        {items.map((item, i) => (
          <ItemCard key={item.id} item={item} viewerRole={viewerRole} index={numbered ? i : undefined} />
        ))}
      </div>
    </div>
  );
}

// Generic renderer for the "From your Clinical Team" section -- groups
// by item_type only, no branching on source_document_type beyond the
// attribution label. Home strategies are simply never in `items` for a
// teacher viewer (the RPC's own item_type scoping excludes them at the
// query level), not conditionally hidden here -- there is no client-side
// filtering standing between a teacher and strategy_home content.
export function ClinicalTeamSection({
  items,
  viewerRole,
}: {
  items: ClinicalContentItem[];
  viewerRole: ClinicalTeamViewerRole;
}) {
  const triggers = items.filter((item) => item.itemType === "trigger");
  const settingEvents = items.filter((item) => item.itemType === "setting_event");
  const home = items.filter((item) => item.itemType === "strategy_home");
  const school = items.filter((item) => item.itemType === "strategy_school");
  const shared = items.filter((item) => item.itemType === "strategy_shared");

  return (
    <div className="flex flex-col gap-6">
      <Group title="Triggers" items={triggers} viewerRole={viewerRole} />
      <Group title="Setting Events" items={settingEvents} viewerRole={viewerRole} />
      <Group title="Home Strategies" items={home} viewerRole={viewerRole} numbered />
      <Group title="School Strategies" items={school} viewerRole={viewerRole} numbered />
      <Group title="Shared Strategies" items={shared} viewerRole={viewerRole} numbered />
    </div>
  );
}
