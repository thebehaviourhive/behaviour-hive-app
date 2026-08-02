import Link from "next/link";
import type { ComponentType } from "react";

export function ComingSoonPage({
  Icon,
  body,
}: {
  Icon: ComponentType<{ className?: string }>;
  body: string;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-safe-ivory">
      <header className="px-4 pt-6 pb-4">
        <Link
          href="/parent-dashboard"
          aria-label="Back"
          className="flex h-8 w-8 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-16">
        <span className="mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-brand-pastel-blue/30 text-brand-prussian-blue">
          <Icon className="h-12 w-12" />
        </span>
        <h1 className="mb-2 font-heading text-2xl font-bold text-brand-prussian-blue">
          Coming Soon!
        </h1>
        <p className="max-w-[280px] text-center font-sans text-base text-brand-neutral-black/80">
          {body}
        </p>
      </main>
    </div>
  );
}
