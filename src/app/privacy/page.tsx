import Link from "next/link";
import { BrandMark } from "@/components/ui/BrandMark";

export default function PrivacyPage() {
  return (
    <main className="flex min-h-full flex-1 justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Privacy Policy
          </h1>
        </div>

        <div className="flex flex-col gap-4 rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
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

          <Link
            href="/"
            className="mt-2 text-center text-sm font-semibold text-brand-prussian-blue"
          >
            Back
          </Link>
        </div>
      </div>
    </main>
  );
}
