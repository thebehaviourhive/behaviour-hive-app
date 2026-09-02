"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CLINICIAN_SPECIALTY_LABEL, type ClinicianSpecialty } from "@/lib/clinicianSpecialties";

// Directory's fifth segment -- left pane. Every clinician this school has
// engaged, with a live count of children they currently cover. Selecting
// a row opens ClinicianCoverageDetail on an already-engaged clinician
// (no code needed -- see migration 0151's "already engaged" auth path).
// "Engage a new clinician" is the OTHER way into the same detail pane --
// a fresh code, looked up once, then never re-asked for in this session.

export interface ClinicianRow {
  clinicianId: string;
  fullName: string;
  specialty: string;
  coveredChildCount: number;
}

export function ClinicianList({
  institutionId,
  selectedClinicianId,
  onSelect,
  onEngageNew,
  refreshToken,
}: {
  institutionId: string | null;
  selectedClinicianId: string | null;
  onSelect: (clinician: ClinicianRow) => void;
  onEngageNew: () => void;
  refreshToken: number;
}) {
  const [clinicians, setClinicians] = useState<ClinicianRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (instId: string) => {
    setIsLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("get_institution_clinicians", { p_institution_id: instId });
    if (rpcError) {
      setError("Could not load clinicians.");
      setIsLoading(false);
      return;
    }
    setClinicians(
      (
        (data ?? []) as { clinician_id: string; full_name: string; specialty: string; covered_child_count: number }[]
      ).map((r) => ({
        clinicianId: r.clinician_id,
        fullName: r.full_name,
        specialty: r.specialty,
        coveredChildCount: r.covered_child_count,
      }))
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!institutionId) return;
    async function run() {
      await load(institutionId!);
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId]);

  useEffect(() => {
    if (!institutionId || refreshToken === 0) return;
    async function run() {
      await load(institutionId!);
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  return (
    <div>
      <button
        type="button"
        onClick={onEngageNew}
        className="mb-4 w-full rounded-2xl border-2 border-dashed border-brand-prussian-blue/30 py-3 text-center font-sans text-body font-semibold text-brand-prussian-blue"
      >
        + Engage a New Clinician
      </button>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
        </div>
      ) : error ? (
        <p className="font-sans text-body text-brand-neutral-black/60">{error}</p>
      ) : clinicians.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
          This school hasn&apos;t engaged any clinicians yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {clinicians.map((c) => {
            const isSelected = c.clinicianId === selectedClinicianId;
            return (
              <button
                key={c.clinicianId}
                type="button"
                onClick={() => onSelect(c)}
                className={`w-full rounded-2xl border p-4 text-left ${
                  isSelected
                    ? "border-brand-prussian-blue bg-brand-pastel-blue/10"
                    : "border-black/5 bg-white shadow-sm"
                }`}
              >
                <p className="font-heading text-h2 font-semibold text-brand-prussian-blue lg:text-body lg:font-semibold lg:text-brand-neutral-black">
                  {c.fullName}
                </p>
                <p className="mt-0.5 font-sans text-body text-brand-neutral-black/50 lg:text-eyebrow">
                  {CLINICIAN_SPECIALTY_LABEL[c.specialty as ClinicianSpecialty] ?? c.specialty} · {c.coveredChildCount}{" "}
                  child{c.coveredChildCount === 1 ? "" : "ren"} covered
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
