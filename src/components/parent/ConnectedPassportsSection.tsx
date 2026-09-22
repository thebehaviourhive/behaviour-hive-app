"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ClaimCodeEntry } from "./ClaimCodeEntry";

// A parent can no longer CREATE a passport -- the school or clinic
// owns it (Stage 2, 15 Sept 2026, self-creation retired).
//
// Parent-track card swap, 23 Sept 2026 -- Daniel's own instruction:
// once a parent has at least one passport connected, code entry is no
// longer the thing this card should be selling dashboard space to --
// most parents have one child in the system, and the code-entry box
// (still the ONLY way in for a parent with zero passports) moves,
// quietly, onto the passport screen itself (ClaimCodeEntry's own
// "quiet" variant, wired into passport/dashboard/page.tsx). In its
// place: a direct "+ ABC Log" action, since that's the thing a
// connected parent actually reaches for day to day.
//
// WHICH CHILD IT LOGS FOR: one connected child, go straight there, no
// question asked. More than one, ask -- but "ask" is this card's own
// existing list of children, not a new picker component; tapping
// "+ ABC Log" with more than one child simply reveals which of the
// list entries below is clickable for logging, inline, rather than
// opening a second sheet on top of a list that's already right there.
interface ConnectedPassport {
  passportId: string;
  childName: string;
}

export function ConnectedPassportsSection() {
  const router = useRouter();
  const [passports, setPassports] = useState<ConnectedPassport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPickingChild, setIsPickingChild] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("get_my_passports");
    if (rpcError) {
      console.error("Failed to load connected passports:", rpcError);
      setIsLoading(false);
      return;
    }
    setPassports(
      ((data ?? []) as { passport_id: string; child_name: string }[]).map((row) => ({
        passportId: row.passport_id,
        childName: row.child_name,
      }))
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function handleLogClick() {
    if (passports.length === 1) {
      router.push(`/passport/dashboard?passportId=${passports[0].passportId}&logIncident=1`);
      return;
    }
    setIsPickingChild(true);
  }

  if (isLoading) {
    return <div className="h-24 animate-pulse rounded-2xl bg-white" />;
  }

  if (passports.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <ClaimCodeEntry variant="prominent" onConnected={load} />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleLogClick}
        className="w-full rounded-2xl border-2 border-brand-prussian-blue py-3.5 text-base font-semibold text-brand-prussian-blue"
      >
        + ABC Log
      </button>

      <div className="flex flex-col gap-2">
        {passports.map((p) => (
          <Link
            key={p.passportId}
            href={
              isPickingChild
                ? `/passport/dashboard?passportId=${p.passportId}&logIncident=1`
                : `/passport/dashboard?passportId=${p.passportId}`
            }
            className="flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm transition-colors active:bg-black/[0.02]"
          >
            <span className="text-sm font-semibold text-brand-neutral-black">{p.childName}</span>
            <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/40 px-4 py-1.5 text-xs font-semibold text-brand-prussian-blue">
              {isPickingChild ? "Log for this child" : "View passport"}
            </span>
          </Link>
        ))}
      </div>

      {isPickingChild && (
        <button
          type="button"
          onClick={() => setIsPickingChild(false)}
          className="self-start text-xs font-semibold text-black/50"
        >
          Cancel
        </button>
      )}
    </section>
  );
}
