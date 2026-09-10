// The privacy policy's body copy, shared by the standalone /privacy
// route and (historically) the in-app sheet the old consent screen
// opened over itself. One copy of the words, every presentation reads
// from it -- never let them drift.
//
// Rewritten alongside the consent/agreement screens rebuild (CLAUDE.md,
// "Parent-track leftovers") -- the previous version claimed "the data
// you enter about your child belongs to you" and that a parent could
// review and revoke a SCHOOL's access "at any time from the passport's
// Manage Access section." Both were false: the school creates and
// keeps its own record of what happens at school, under its own
// obligations, and that record was never revocable by a parent -- the
// "Manage Access" section that once let a parent approve/revoke a
// school by code was removed as part of the school-led pivot (PRD 3,
// Stage 2) and no longer exists. What IS true, and what this now says:
// the parent controls their own contributions (what they add from
// home) and their own clinician connections -- the school's own record
// and a clinician's own published clinical guidance are not theirs to
// revoke.
export function PrivacyPolicyContent() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-brand-neutral-black/80">
        Your child&apos;s school creates and keeps their own record of what happens at school, under its own
        obligations. You can add what you know from home, and you control what you add and who you connect as
        your child&apos;s clinician.
      </p>

      <div>
        <h2 className="mb-1 text-sm font-semibold text-brand-neutral-black">What we collect</h2>
        <p className="text-sm leading-relaxed text-brand-neutral-black/70">
          What you add from home -- how your child slept, what works at home, what to watch for -- and what your
          child&apos;s teachers and clinicians add at school: behavioural signals, communication preferences,
          incident logs, and related notes. Used only to support your child.
        </p>
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold text-brand-neutral-black">Who can see it</h2>
        <p className="text-sm leading-relaxed text-brand-neutral-black/70">
          What you add from home goes to the people supporting your child at school, and to any clinician you
          connect -- you control that connection, and can end it at any time. What the school records about your
          child at school is the school&apos;s own record, kept under its own obligations; it is not something a
          parent can revoke.
        </p>
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold text-brand-neutral-black">Your rights</h2>
        <p className="text-sm leading-relaxed text-brand-neutral-black/70">
          You can request a copy of what you&apos;ve added, or ask us to delete it, at any time by contacting us
          below. A request about your child&apos;s school record is one for the school itself to answer, under its
          own retention policy.
        </p>
      </div>

      <p className="text-xs leading-relaxed text-brand-neutral-black/50">
        This page is a plain-language summary, not the full legal policy. For questions or requests regarding your
        data, contact us at{" "}
        <a href="mailto:info@thebehaviourhive.com" className="font-semibold text-brand-prussian-blue">
          info@thebehaviourhive.com
        </a>
        .
      </p>
    </div>
  );
}
