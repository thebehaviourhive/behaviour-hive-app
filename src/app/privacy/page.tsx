"use client";

import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/ui/BrandMark";
import { PrivacyPolicyContent } from "@/components/PrivacyPolicyContent";

export default function PrivacyPage() {
  const router = useRouter();

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
          <PrivacyPolicyContent />

          {/* CRITICAL BUG fix: this used to be a hard-coded Link to "/" --
              on an authenticated user, "/" unconditionally redirects by
              role (see src/app/page.tsx), which is exactly what let this
              page's own Back button carry someone straight past an
              unconfirmed consent screen. router.back() returns to
              whatever actually linked here instead of assuming "/" is
              always correct. */}
          <button
            type="button"
            onClick={() => router.back()}
            className="mt-2 text-center text-sm font-semibold text-brand-prussian-blue"
          >
            Back
          </button>
        </div>
      </div>
    </main>
  );
}
