"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { logActivity } from "@/lib/logActivity";
import { formatClinicianReference } from "@/lib/clinicianDisplayName";
import { ClinicianBottomNav } from "@/components/clinician/ClinicianBottomNav";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { BottomSheet } from "@/components/ui/BottomSheet";
import type { FbaStatus } from "@/lib/fba/types";

interface ClinicianFbaRow {
  fba_id: string;
  passport_id: string;
  child_name: string;
  status: FbaStatus;
  updated_at: string;
}

interface ClinicianPassportOption {
  passport_id: string;
  child_name: string;
}

const STATUS_LABEL: Record<FbaStatus, string> = {
  draft: "Draft",
  in_progress: "In Progress",
  completed: "Completed",
};

const STATUS_PILL_CLASSES: Record<FbaStatus, string> = {
  draft: "bg-black/5 text-brand-neutral-black/60",
  in_progress: "bg-brand-golden-brown/15 text-brand-golden-brown",
  completed: "bg-green-100 text-green-700",
};

// A Postgres unique-violation, surfaced when the concurrent-FBA
// precheck below missed a race (or an active FBA already exists that
// belongs to a *different* clinician on a shared passport -- this
// clinician's own fba list never includes those rows, so only the DB
// constraint itself can catch that case).
const UNIQUE_VIOLATION = "23505";

export default function ClinicianFbaListPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("clinician");

  const [tab, setTab] = useState<"active" | "completed">("active");
  const [fbas, setFbas] = useState<ClinicianFbaRow[]>([]);
  const [outstandingCounts, setOutstandingCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [passports, setPassports] = useState<ClinicianPassportOption[]>([]);
  const [isLoadingPassports, setIsLoadingPassports] = useState(false);
  const [passportsLoadError, setPassportsLoadError] = useState<string | null>(null);
  const [creatingForPassportId, setCreatingForPassportId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_clinician_fbas");

    if (error) {
      console.error("Failed to load FBAs:", error);
      setLoadError("Couldn't load your FBAs.");
      setIsLoading(false);
      return;
    }

    const fbaRows = (data ?? []) as ClinicianFbaRow[];
    setFbas(fbaRows);

    // Cheap outstanding-questionnaire hint per card -- one extra query,
    // no new RPC needed: the clinician's existing SELECT policy on
    // fba_instrument_requests (via the fba_reports/clinician_access
    // join) already covers this.
    const activeIds = fbaRows.filter((fba) => fba.status !== "completed").map((fba) => fba.fba_id);
    if (activeIds.length > 0) {
      const { data: requestRows, error: requestError } = await supabase
        .from("fba_instrument_requests")
        .select("fba_id, status")
        .in("fba_id", activeIds)
        .neq("status", "completed");
      if (!requestError) {
        const counts: Record<string, number> = {};
        for (const row of requestRows ?? []) {
          counts[row.fba_id] = (counts[row.fba_id] ?? 0) + 1;
        }
        setOutstandingCounts(counts);
      }
    } else {
      setOutstandingCounts({});
    }

    setIsLoading(false);
  }, []);

  // Fetches once the role check is ready and whenever `load`'s identity
  // changes -- a genuine effect for syncing with the external data
  // source, not a synchronous state derivation.
  useEffect(() => {
    if (!isReady) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [isReady, load]);

  const loadPassports = useCallback(async () => {
    setIsLoadingPassports(true);
    setPassportsLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_clinician_passports");

    if (error) {
      console.error("Failed to load clinician passports:", error);
      setPassportsLoadError("Couldn't load your cases.");
      setIsLoadingPassports(false);
      return;
    }

    setPassports((data ?? []) as ClinicianPassportOption[]);
    setIsLoadingPassports(false);
  }, []);

  function openPicker() {
    setCreateError(null);
    setIsPickerOpen(true);
    loadPassports();
  }

  async function startFba(passport: ClinicianPassportOption) {
    if (!user) return;
    setCreateError(null);

    const alreadyActive = fbas.some(
      (fba) => fba.passport_id === passport.passport_id && fba.status !== "completed"
    );
    if (alreadyActive) {
      setCreateError("An active FBA already exists for this child.");
      return;
    }

    setCreatingForPassportId(passport.passport_id);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("fba_reports")
      .insert({
        passport_id: passport.passport_id,
        clinician_id: user.id,
        status: "draft",
        // Section 1's "report date" is auto-set at creation -- it's the
        // date the assessment was opened, and doubles as that section's
        // completeness signal (see getSectionCompleteness).
        content_data: { reportDate: new Date().toISOString().slice(0, 10) },
      })
      .select("id")
      .single();

    setCreatingForPassportId(null);

    if (error || !data) {
      if (error?.code === UNIQUE_VIOLATION) {
        setCreateError("An active FBA already exists for this child.");
      } else {
        console.error("Failed to create FBA:", error);
        setCreateError("Couldn't start a new FBA. Please try again.");
      }
      return;
    }

    // Own verified profile, not user_metadata -- "specialty from the
    // verified profile" is the naming standard's whole point, and
    // clinicians.full_name is guaranteed populated for any verified
    // clinician (submit_clinician_verification requires it non-empty).
    const { data: clinicianRow } = await supabase
      .from("clinicians")
      .select("full_name, specialty")
      .eq("user_id", user.id)
      .maybeSingle();

    logActivity({
      passportId: passport.passport_id,
      actorId: user.id,
      eventType: "fba_started",
      eventDescription: `Functional Behaviour Assessment started by ${formatClinicianReference(clinicianRow?.full_name, clinicianRow?.specialty)}`,
    });

    router.push(`/clinician/fba/${data.id}`);
  }

  if (!isReady) {
    return null;
  }

  const visibleFbas = fbas.filter((fba) =>
    tab === "active" ? fba.status !== "completed" : fba.status === "completed"
  );

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center gap-3 px-4 pt-6 pb-2">
        <Link
          href="/clinician/dashboard"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
          Functional Behaviour Assessments
        </h1>
      </header>

      <div className="flex gap-2 px-4 pt-3">
        {(["active", "completed"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setTab(option)}
            className={`flex-1 rounded-2xl border px-2 py-2.5 text-sm font-semibold capitalize transition-colors ${
              tab === option
                ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                : "border-black/10 bg-white text-black/60"
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <main className="flex flex-1 flex-col gap-3 px-4 pt-4">
        {isLoading ? (
          <>
            <FbaCardSkeleton />
            <FbaCardSkeleton />
          </>
        ) : loadError ? (
          <InlineErrorState message={loadError} onRetry={load} />
        ) : visibleFbas.length === 0 ? (
          <div className="mt-2 rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
            <p className="text-sm text-brand-neutral-black/70">
              {tab === "active"
                ? "No active FBAs yet. Start one below for any case in your caseload."
                : "Completed FBAs will appear here."}
            </p>
          </div>
        ) : (
          visibleFbas.map((fba) => (
            <Link
              key={fba.fba_id}
              href={`/clinician/fba/${fba.fba_id}`}
              className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-heading text-lg font-bold text-brand-neutral-black">
                  {fba.child_name}
                </h2>
                <span
                  className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_PILL_CLASSES[fba.status]}`}
                >
                  {STATUS_LABEL[fba.status]}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-brand-neutral-black/50">
                Last updated {format(new Date(fba.updated_at), "d MMM yyyy")}
              </p>
              {(outstandingCounts[fba.fba_id] ?? 0) > 0 && (
                <p className="mt-1 text-xs font-semibold text-brand-golden-brown">
                  {outstandingCounts[fba.fba_id]} questionnaire
                  {outstandingCounts[fba.fba_id] === 1 ? "" : "s"} outstanding
                </p>
              )}
            </Link>
          ))
        )}

        {tab === "active" && (
          <button
            type="button"
            onClick={openPicker}
            className="mt-2 rounded-2xl border-2 border-dashed border-brand-pastel-blue py-3.5 text-sm font-semibold text-brand-prussian-blue"
          >
            + Start New FBA
          </button>
        )}
      </main>

      <ClinicianBottomNav />

      <BottomSheet isOpen={isPickerOpen} onClose={() => setIsPickerOpen(false)}>
        <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
          Start New FBA
        </h2>
        <p className="mb-4 mt-1 text-sm text-brand-neutral-black/60">
          Select a case from your caseload.
        </p>

        {isLoadingPassports ? (
          <div className="flex flex-col gap-2">
            <div className="h-14 animate-pulse rounded-2xl bg-brand-off-white" />
            <div className="h-14 animate-pulse rounded-2xl bg-brand-off-white" />
          </div>
        ) : passportsLoadError ? (
          <InlineErrorState message={passportsLoadError} onRetry={loadPassports} />
        ) : passports.length === 0 ? (
          <p className="text-sm text-brand-neutral-black/60">
            No cases in your caseload yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {passports.map((passport) => (
              <button
                key={passport.passport_id}
                type="button"
                onClick={() => startFba(passport)}
                disabled={creatingForPassportId !== null}
                className="w-full rounded-2xl border border-black/5 bg-white p-4 text-left text-base font-semibold text-brand-neutral-black shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingForPassportId === passport.passport_id
                  ? "Starting…"
                  : passport.child_name}
              </button>
            ))}
          </div>
        )}

        {createError && (
          <p role="alert" className="mt-4 text-sm font-medium text-red-600">
            {createError}
          </p>
        )}
      </BottomSheet>
    </div>
  );
}

function FbaCardSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="h-5 w-28 rounded bg-brand-off-white" />
        <div className="h-5 w-16 rounded-full bg-brand-off-white" />
      </div>
      <div className="mt-3 h-3 w-32 rounded bg-brand-off-white" />
    </div>
  );
}
