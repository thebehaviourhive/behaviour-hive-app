"use client";

import Link from "next/link";
import { PrincipalBottomNav } from "@/components/principal/PrincipalBottomNav";

// PRD 2, Stage 1. New top-level tab -- "Directory" is the shared
// destination for Staff, Classes and Passports, which stay three
// separate, unreconciled routes for now (their own content is Stages
// 2/3/5's job, not this one). This stage only gives them a shared
// entry point and a shared active-tab state via
// PrincipalBottomNav's own isActive matcher -- deliberately not a
// redesign of what's inside any of the three.
//
// PRD 2, Stage 6: Temporary Access joins as a fourth card. It's the
// same shape of thing as the other three -- a live roster of who
// currently has standing over what, revocable from the view itself --
// not a setting (School's own charter) and not an overview metric
// (Dashboard's). The cut-off-time control itself lives on School
// instead; this card is the live view only.

const CARDS = [
  {
    href: "/principal/staff",
    title: "Staff",
    description: "Approve joins, deactivate staff, hand over your role.",
  },
  {
    href: "/principal/classes",
    title: "Classes",
    description: "Create classes, assign teachers and SNAs, grant temporary cover.",
  },
  {
    href: "/principal/passports",
    title: "Passports",
    description: "Enrol children, manage access and each child's clinical team.",
  },
  {
    href: "/principal/temporary-access",
    title: "Temporary Access",
    description: "See every active and recent cover grant across the school, and revoke early.",
  },
] as const;

export default function PrincipalDirectoryPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="px-4 pt-6 pb-4">
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Directory</h1>
      </header>

      <main className="flex-1 px-4">
        <div className="flex flex-col gap-2">
          {CARDS.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="block rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
            >
              <p className="text-sm font-semibold text-brand-neutral-black">{card.title}</p>
              <p className="mt-0.5 text-xs text-brand-neutral-black/50">{card.description}</p>
            </Link>
          ))}
        </div>
      </main>

      <PrincipalBottomNav />
    </div>
  );
}
