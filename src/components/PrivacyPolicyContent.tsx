// The privacy policy's body copy, shared by the standalone /privacy
// route and the in-app sheet the consent screen opens over itself (see
// CRITICAL BUG fix: the sheet exists specifically so a mid-consent user
// never has to leave the consent screen's mounted state to read this).
// One copy of the words, two presentations -- never let them drift.
export function PrivacyPolicyContent() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-brand-neutral-black/80">
        The Behaviour Hive is built around a simple principle: the data
        you enter about your child belongs to you.
      </p>

      <div>
        <h2 className="mb-1 text-sm font-semibold text-brand-neutral-black">
          What we collect
        </h2>
        <p className="text-sm leading-relaxed text-brand-neutral-black/70">
          Information you and your child&apos;s teachers and clinicians
          add to their passport — behavioural signals, communication
          preferences, incident logs, and related notes — used only to
          support your child.
        </p>
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold text-brand-neutral-black">
          Who can see it
        </h2>
        <p className="text-sm leading-relaxed text-brand-neutral-black/70">
          Only people you actively approve using a passport, school, or
          clinician code. Access can be reviewed and revoked at any time
          from the passport&apos;s Manage Access section.
        </p>
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold text-brand-neutral-black">
          Your rights
        </h2>
        <p className="text-sm leading-relaxed text-brand-neutral-black/70">
          You can request a copy of your data or ask us to delete it at
          any time by contacting us below.
        </p>
      </div>

      <p className="text-xs leading-relaxed text-brand-neutral-black/50">
        This page is a plain-language summary, not the full legal policy.
        For questions or requests regarding your data, contact us at{" "}
        <a
          href="mailto:info@thebehaviourhive.com"
          className="font-semibold text-brand-prussian-blue"
        >
          info@thebehaviourhive.com
        </a>
        .
      </p>
    </div>
  );
}
