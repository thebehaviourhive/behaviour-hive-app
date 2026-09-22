"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionType } from "@/hooks/useInstitutionType";
import { createClient } from "@/lib/supabase/client";
import { SessionTypeFormSheet, type SessionTypeRow } from "@/components/principal/SessionTypeFormSheet";

// Session types, fixed -> clinic-configurable catalogue (migration
// 0281). Its own sub-page, linked from a summary row on
// /principal/clinic, matching /principal/clinic/tags' own precedent --
// a real catalogue with several fields per row is not a single
// BottomSheet the way clinic hours or the cancellation policy are.
//
// Same school-principal redirect guard as the rest of /principal/clinic
// -- a school has no session_types at all (this table only ever seeds
// for institutions.type = 'clinic'), and this route would otherwise
// happily render an empty, meaningless catalogue editor for someone
// whose institution has none of these rows.

const LOCATION_MODE_LABEL: Record<string, string> = { online: "Online", in_person: "In-person", elsewhere: "Elsewhere" };

function formatTypeSummary(type: SessionTypeRow): string {
  const modeLabel = LOCATION_MODE_LABEL[type.location_mode] ?? type.location_mode;
  const parts = [modeLabel, `${type.length_minutes} min`];
  if (type.travel_before_minutes > 0 || type.travel_after_minutes > 0) {
    parts.push(`+${type.travel_before_minutes}/+${type.travel_after_minutes} min travel`);
  }
  if (!type.is_parent_bookable) parts.push("Staff arrange");
  return parts.join(" · ");
}

export default function ClinicSessionTypesPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("principal");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const { institutionType, isLoading: isInstitutionTypeLoading } = useInstitutionType(institutionId);

  useEffect(() => {
    if (!isInstitutionTypeLoading && institutionId && institutionType === "school") {
      router.replace("/principal/school");
    }
  }, [isInstitutionTypeLoading, institutionId, institutionType, router]);

  const [types, setTypes] = useState<SessionTypeRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retiringId, setRetiringId] = useState<string | null>(null);

  const [formTarget, setFormTarget] = useState<SessionTypeRow | null | "new">(null);

  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();

    const { data: staffRow } = await supabase
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", user.id)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (!staffRow) {
      setLoadError("Could not find your clinic.");
      setIsLoading(false);
      return;
    }
    setInstitutionId(staffRow.institution_id);

    const { data: typeRows, error: typesError } = await supabase
      .from("session_types")
      .select(
        "id, name, description, location_mode, length_minutes, travel_before_minutes, travel_after_minutes, is_parent_bookable, is_active, location_details"
      )
      .eq("institution_id", staffRow.institution_id)
      .order("sort_order")
      .order("name");

    if (typesError) {
      setLoadError(typesError.message);
      setIsLoading(false);
      return;
    }
    setTypes((typeRows ?? []) as SessionTypeRow[]);
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleSetActive(type: SessionTypeRow, isActive: boolean) {
    setRetiringId(type.id);
    setActionError(null);
    const supabase = createClient();
    const { error } = await supabase.from("session_types").update({ is_active: isActive }).eq("id", type.id);
    setRetiringId(null);
    if (error) {
      setActionError(error.message);
      return;
    }
    await load();
  }

  const activeTypes = types.filter((t) => t.is_active);
  const retiredTypes = types.filter((t) => !t.is_active);

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/principal/clinic"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Session Types</h1>
      </header>

      <main className="flex-1 px-4">
        <div className="lg:max-w-[66.6667%]">
          <p className="text-sm text-brand-neutral-black/70">
            What a parent can book, and how long it takes to get ready for -- length, travel time before and after,
            and whether parents can book it themselves or your team arranges it directly.
          </p>

          {isLoading ? (
            <div className="mt-4 flex flex-col gap-2">
              <div className="h-[80px] animate-pulse rounded-2xl bg-white" />
              <div className="h-[80px] animate-pulse rounded-2xl bg-white" />
            </div>
          ) : loadError ? (
            <p className="mt-4 text-sm text-brand-neutral-black/60">{loadError}</p>
          ) : (
            <>
              {actionError && (
                <p role="alert" className="mt-4 rounded-xl bg-brand-golden-brown/10 p-3 text-sm font-medium text-brand-golden-brown">
                  {actionError}
                </p>
              )}

              {activeTypes.length === 0 && (
                <p className="mt-4 rounded-2xl border border-dashed border-brand-golden-brown/40 bg-brand-safe-ivory/30 p-4 text-sm text-brand-neutral-black/70">
                  No session types configured yet. Until you add one, parents cannot book anything with your clinic.
                </p>
              )}

              <button
                type="button"
                onClick={() => setFormTarget("new")}
                className="mt-4 block w-full lg:w-auto rounded-2xl border border-dashed border-brand-prussian-blue/40 px-4 py-3 text-center text-sm font-semibold text-brand-prussian-blue"
              >
                + New Session Type
              </button>

              <div className="mt-4 flex flex-col gap-2">
                {activeTypes.map((type) => (
                  <div key={type.id} className="flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                    <div>
                      <p className="font-sans text-body font-semibold text-brand-neutral-black">{type.name}</p>
                      <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/50">{formatTypeSummary(type)}</p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-3">
                      <button type="button" onClick={() => setFormTarget(type)} className="text-xs font-semibold text-brand-prussian-blue">
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetActive(type, false)}
                        disabled={retiringId === type.id}
                        className="text-xs font-semibold text-brand-neutral-black/50"
                      >
                        Retire
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {retiredTypes.length > 0 && (
                <div className="mt-6 flex flex-col gap-2">
                  <p className="font-accent text-eyebrow font-semibold uppercase tracking-wide text-brand-neutral-black/40">
                    Retired ({retiredTypes.length})
                  </p>
                  {retiredTypes.map((type) => (
                    <div key={type.id} className="flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-black/[0.02] p-4">
                      <div>
                        <p className="font-sans text-body font-medium text-brand-neutral-black/50 line-through">{type.name}</p>
                        <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/40">{formatTypeSummary(type)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSetActive(type, true)}
                        disabled={retiringId === type.id}
                        className="flex-shrink-0 text-xs font-semibold text-brand-prussian-blue"
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {institutionId && (
        <SessionTypeFormSheet
          isOpen={formTarget !== null}
          institutionId={institutionId}
          existing={formTarget === "new" || formTarget === null ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={() => {
            setFormTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}
