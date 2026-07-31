"use client";

import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/ui/BrandMark";
import { useRequireRole } from "@/hooks/useRequireRole";

export default function MorningCheckinPage() {
  const router = useRouter();
  const { isReady } = useRequireRole("parent");

  if (!isReady) {
    return null;
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex flex-col items-center gap-3">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Morning Check-in
          </h1>
          <p className="text-sm text-black/50">This feature is coming soon</p>
        </div>

        <button
          type="button"
          onClick={() => router.push("/parent-dashboard")}
          className="w-full rounded-2xl border-2 border-brand-prussian-blue bg-white px-5 py-3.5 text-base font-semibold text-brand-prussian-blue transition-colors hover:bg-brand-pastel-blue/20"
        >
          Back
        </button>
      </div>
    </main>
  );
}
