import { PLACEHOLDER_EMERGENCY_CONTACTS } from "@/lib/calmCards/escalationContacts";

// Calm, clear, large -- no logging prompts anywhere on or after this
// path (constraint 3A). This screen renders unconditionally once
// reached; the caller (CalmFlow) is responsible for having already
// fired record_calm_episode(reached_safety: true) before mounting it,
// so the red notice/activity_log side effects are never dependent on
// anything happening on this screen itself.
export function CalmEscalationScreen() {
  return (
    <div className="flex h-full flex-col justify-center gap-6 px-6 text-center">
      <h1 className="font-heading text-2xl font-bold text-brand-neutral-black">
        If anyone is in immediate danger, call emergency services
      </h1>

      <div className="flex flex-col gap-3">
        <a
          href="tel:999"
          className="w-full rounded-2xl bg-brand-prussian-blue py-4 text-xl font-bold text-white"
        >
          Call 999
        </a>
        <a
          href="tel:112"
          className="w-full rounded-2xl border-2 border-brand-prussian-blue py-4 text-xl font-bold text-brand-prussian-blue"
        >
          Call 112
        </a>
      </div>

      <div className="mt-4 flex flex-col gap-3 text-left">
        {PLACEHOLDER_EMERGENCY_CONTACTS.map((contact) => (
          <div key={contact.label} className="rounded-2xl border border-dashed border-black/15 bg-white/60 p-4">
            <p className="text-sm font-semibold text-brand-neutral-black">{contact.label}</p>
            <p className="mt-1 text-xs text-brand-neutral-black/60">{contact.description}</p>
            {contact.phone && (
              <a href={`tel:${contact.phone}`} className="mt-2 inline-block text-sm font-semibold text-brand-prussian-blue">
                {contact.phone}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
