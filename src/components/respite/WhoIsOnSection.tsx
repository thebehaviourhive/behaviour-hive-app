import { OnCallCard } from "@/components/respite/OnCallCard";

// Respite UI Stage 2a, block 4 -- a fact, not an action. "Set on-call"
// moved to /centre/settings (OnCallCard is reused there with
// canSet={true}) -- the dashboard now only ever reads it.
//
// "Which staff are on shift, if the centre tracks that" was asked for
// alongside on-call, and checked directly before assuming it exists:
// no shift/rota schema exists anywhere in this database for
// centre_manager/care_staff -- "shift" appears only in Handover's own
// copy, never as data. Shown honestly as just on-call, rather than
// inventing a roster this schema has no way to back.
export function WhoIsOnSection({ institutionId }: { institutionId: string | null }) {
  return (
    <section>
      <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
        Who is On
      </h2>
      <OnCallCard institutionId={institutionId} canSet={false} showHeading={false} />
    </section>
  );
}
