import Link from "next/link";
import { BrandMark } from "@/components/ui/BrandMark";

export default function PassportSectionAPage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex flex-col items-center gap-3">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Passport creation
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <p className="text-sm leading-relaxed text-black/60">
            The passport creation flow (sections A–D) hasn&apos;t been built
            yet — this is a placeholder landing page.
          </p>

          <Link
            href="/parent-dashboard"
            className="mt-5 inline-block text-sm font-semibold text-brand-prussian-blue"
          >
            ← Back to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
