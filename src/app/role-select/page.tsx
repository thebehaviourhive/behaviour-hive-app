"use client";

import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/ui/BrandMark";

// Onboarding, Sept 2026: this used to BE the institution-code screen --
// the very first thing anyone saw after signing up. That screen has
// always asked for an "organisation code", which a parent doesn't have
// and has never heard of -- the only escape hatch was a small link
// ("I don't have a code, or I'm a parent") buried under a text field
// meant for someone else. Real confusion, reported directly.
//
// This screen goes in front of it instead: a plain fork before any code
// is asked for. Staff go on to the code screen, now at its own route
// (/role-select/institution), completely unchanged -- same lookup, same
// destinations, same "I don't have a code" escape hatch for a genuine
// staff member without one. Parents go to their own path
// (/role-select/parent), which asks for their child's CLAIM code --
// a different code, from a different place, and conflating the two is
// exactly what confused people before.
//
// "Respite centre" in the staff option's own copy is wording only --
// no new institution type, no branching, nothing schema-level. The
// institution code itself still decides what an organisation actually
// is, exactly as it always has; respite centres are their own,
// separate, not-yet-built piece of work and this screen doesn't
// anticipate them any further than this one line.
export default function RoleSelectPage() {
  const router = useRouter();

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Let&apos;s get you set up
          </h1>
          <p className="text-sm leading-relaxed text-black/50">Which of these are you?</p>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => router.push("/role-select/institution")}
              className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-3 text-left transition-colors hover:bg-black/[0.02]"
            >
              <span
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-black/5 text-lg"
                aria-hidden
              >
                🏫
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold text-brand-neutral-black">
                  I work at a school, clinic or respite centre
                </span>
                <span className="block text-xs text-black/50">
                  I have a code from my organisation
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => router.push("/role-select/parent")}
              className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-3 text-left transition-colors hover:bg-black/[0.02]"
            >
              <span
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-black/5 text-lg"
                aria-hidden
              >
                ❤
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold text-brand-neutral-black">
                  I am a parent or guardian
                </span>
                <span className="block text-xs text-black/50">
                  I&apos;m setting up my child&apos;s record
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
