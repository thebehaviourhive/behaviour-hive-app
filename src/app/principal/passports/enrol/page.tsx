"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionType } from "@/hooks/useInstitutionType";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

// PRD 2, Stage 3. Full-screen, not a bottom sheet -- "Enrolling creates
// the child," per the design's own instruction, a deliberate act
// weighted the same way Handover's own full-screen sheet is (a
// deliberate context switch, not a quick action). Replaces
// EnrolChildSheet.tsx entirely (its own only caller); the write itself
// is unchanged for a school -- create_school_passport() (0113/0121),
// the same RPC, same single required field.
//
// Tier 1 item 1, 21 Sept 2026, the "active harm" fix: this screen was
// the ONLY reachable "add a client" entry point at a clinic institution
// too, and it unconditionally called create_school_passport() --
// producing an `enrolments` row for a clinic client, a table that is
// structurally invisible to tags, scope, discharge, and the
// stagnation queue forever (episodes_of_care is the parallel,
// clinic-only table those all key off; see CLAUDE.md's own "reuse the
// enrolment shape means the shape, never the table" entry). Checked
// directly against production before fixing anything: zero wrong
// enrolments/episodes_of_care rows exist for the one real clinic --
// nothing to clean up, this was caught before any real client was
// added through it. Now branches on institutionType and calls
// onboard_clinic_client() (0210, already built, already tested, zero
// callers until this) for a clinic -- same uuid return shape, same
// redirect.
//
// PRD 10 Stage 2, 21 Sept 2026 -- the gate widens, and tag selection
// arrives. onboard_clinic_client() has always admitted THREE roles at
// a clinic (principal, clinic_admin, and clinician when
// practitioner_can_onboard is on) -- this screen's own gate admitted
// only "principal", so an admin or a toggle-enabled practitioner could
// never reach the one screen that lets them exercise an authority the
// backend already gave them. Widened to match. set_episode_tags()
// itself only ever admits principal/clinic_admin (0214's own header:
// "clinical_lead and clinician are not callers at all -- neither role
// is named as a tagger anywhere in PRD section 5") -- so the tag step
// below is shown only for those two, never for a practitioner, exactly
// matching what the RPC would accept if it tried.
//
// The SCHOOL branch is completely untouched -- create_school_passport()
// stays principal-only (confirmed by reading its own live 0140 body),
// so a school principal's own flow, form, and copy are byte-identical
// to before this stage.

interface TagOption {
  id: string;
  dimension: string;
  value: string;
}

type CallerRole = "principal" | "clinic_admin" | "clinician";

export default function EnrolChildPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole(["principal", "clinic_admin", "clinician"]);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [callerRole, setCallerRole] = useState<CallerRole | null>(null);
  const [practitionerCanOnboard, setPractitionerCanOnboard] = useState(false);
  const [isResolvingCaller, setIsResolvingCaller] = useState(true);
  const { institutionType, isLoading: isInstitutionTypeLoading } = useInstitutionType(institutionId);
  const [childName, setChildName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tagOptions, setTagOptions] = useState<TagOption[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [isLoadingTags, setIsLoadingTags] = useState(false);

  // Resolves which of the caller's own institution_staff rows is the
  // one that actually applies here -- a school-engaged clinician (a
  // real, long-standing pattern) must never see a clinic-shaped form,
  // and a clinician at a clinic where the toggle is off must be told
  // plainly, not shown a form that would fail at submit.
  useEffect(() => {
    if (!isReady || !user) return;
    let isMounted = true;
    const supabase = createClient();

    supabase
      .from("institution_staff")
      .select("institution_id, role, institutions(type, practitioner_can_onboard)")
      .eq("user_id", user.id)
      .in("role", ["principal", "clinic_admin", "clinician"])
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .then(({ data }) => {
        if (!isMounted) return;
        const rows = (data ?? []) as Array<{
          institution_id: string;
          role: CallerRole;
          institutions: { type: string; practitioner_can_onboard: boolean } | { type: string; practitioner_can_onboard: boolean }[] | null;
        }>;

        function resolveInstitution(row: (typeof rows)[number]) {
          const inst = row.institutions;
          return Array.isArray(inst) ? inst[0] : inst;
        }

        // Prefer a row that's actually eligible to onboard at a clinic
        // (director/admin always, a practitioner only when the toggle
        // is on) -- falling back to a plain principal row, which
        // preserves the original school-only behaviour exactly.
        const eligibleClinicRow = rows.find((row) => {
          const inst = resolveInstitution(row);
          if (inst?.type !== "clinic") return false;
          if (row.role === "principal" || row.role === "clinic_admin") return true;
          return row.role === "clinician" && inst.practitioner_can_onboard;
        });
        const fallbackPrincipalRow = rows.find((row) => row.role === "principal");
        const chosen = eligibleClinicRow ?? fallbackPrincipalRow ?? null;

        if (chosen) {
          const inst = resolveInstitution(chosen);
          setInstitutionId(chosen.institution_id);
          setCallerRole(chosen.role);
          setPractitionerCanOnboard(Boolean(inst?.practitioner_can_onboard));
        }
        setIsResolvingCaller(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isReady, user]);

  const isClinic = institutionType === "clinic";
  const canTag = isClinic && (callerRole === "principal" || callerRole === "clinic_admin");
  const canOnboard =
    !isResolvingCaller &&
    !isInstitutionTypeLoading &&
    institutionId !== null &&
    (isClinic
      ? callerRole === "principal" || callerRole === "clinic_admin" || (callerRole === "clinician" && practitionerCanOnboard)
      : callerRole === "principal");

  useEffect(() => {
    if (!canTag || !institutionId) return;
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoadingTags(true);
    const supabase = createClient();
    supabase
      .from("institution_tags")
      .select("id, dimension, value")
      .eq("institution_id", institutionId)
      .eq("is_active", true)
      .order("dimension")
      .order("value")
      .then(({ data }) => {
        if (isMounted) {
          setTagOptions((data ?? []) as TagOption[]);
          setIsLoadingTags(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [canTag, institutionId]);

  const tagsByDimension = useMemo(() => {
    const map = new Map<string, TagOption[]>();
    for (const tag of tagOptions) {
      if (!map.has(tag.dimension)) map.set(tag.dimension, []);
      map.get(tag.dimension)!.push(tag);
    }
    return Array.from(map.entries());
  }, [tagOptions]);

  function toggleTag(tagId: string) {
    setSelectedTagIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  async function handleEnrol() {
    if (!user || !childName.trim() || !institutionId) return;
    setIsSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { data: passportId, error: enrolError } = isClinic
      ? await supabase.rpc("onboard_clinic_client", {
          p_institution_id: institutionId,
          p_client_name: childName.trim(),
        })
      : await supabase.rpc("create_school_passport", {
          p_institution_id: institutionId,
          p_child_name: childName.trim(),
        });

    if (enrolError) {
      setIsSubmitting(false);
      setError(enrolError.message);
      return;
    }

    // The one-shot tagging window (0214): set_episode_tags() is only
    // called when the director/admin actually picked at least one tag.
    // A zero-selection submit skips this entirely -- per the decided
    // behaviour, the window stays open for a later visit, since
    // nothing was actually tagged yet.
    if (canTag && selectedTagIds.size > 0) {
      const { data: episodeRow } = await supabase
        .from("episodes_of_care")
        .select("id")
        .eq("passport_id", passportId)
        .eq("institution_id", institutionId)
        .is("ended_at", null)
        .maybeSingle();

      if (episodeRow) {
        const tags = Array.from(selectedTagIds)
          .map((id) => tagOptions.find((t) => t.id === id))
          .filter((t): t is TagOption => Boolean(t))
          .map((t) => ({ dimension: t.dimension, value: t.value }));
        await supabase.rpc("set_episode_tags", { p_episode_id: episodeRow.id, p_tags: tags });
      }
    }

    setIsSubmitting(false);
    router.push(`/principal/passports/${passportId}`);
  }

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/principal/directory?segment=children"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">
          {isClinic ? "Add a Client" : "Enrol a Child"}
        </h1>
      </header>

      <main className="flex-1 px-4">
        {!isResolvingCaller && !isInstitutionTypeLoading && !canOnboard ? (
          <p className="text-sm text-brand-neutral-black/60">
            You don&apos;t have permission to add a client here.
          </p>
        ) : (
          <>
            <p className="text-sm text-brand-neutral-black/70">
              {isClinic
                ? "Creates a new record for this client, started by your clinic. Their parent or guardian claims it later using a code you generate from their own record page — this doesn't require them to do anything yet."
                : "Creates a new passport for this child, started by your school. Their parent or guardian claims it later using a code you generate from their own passport page — this doesn't require them to do anything yet."}
            </p>

            <label className="mt-6 block text-sm font-semibold text-brand-neutral-black" htmlFor="enrol-child-name">
              {isClinic ? "Client's name" : "Child's name"}
            </label>
            <input
              id="enrol-child-name"
              type="text"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              placeholder="e.g. Sam Murphy"
              className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
            />

            {canTag && (
              <div className="mt-6">
                <p className="mb-1 font-sans text-sm font-semibold text-brand-neutral-black">Tags (optional)</p>
                <p className="mb-3 text-xs text-brand-neutral-black/50">
                  You can only set these once, right now — any later change goes through a request. Leave everything
                  unselected to decide later; nothing here is required.
                </p>
                {isLoadingTags ? (
                  <div className="h-[60px] animate-pulse rounded-xl bg-white" />
                ) : tagsByDimension.length === 0 ? (
                  <p className="text-xs text-brand-neutral-black/50">
                    No tags configured yet for your clinic — nothing to select.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {tagsByDimension.map(([dimension, options]) => (
                      <div key={dimension}>
                        <p className="mb-1.5 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                          {dimension}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {options.map((tag) => {
                            const isSelected = selectedTagIds.has(tag.id);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => toggleTag(tag.id)}
                                aria-pressed={isSelected}
                                className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                                  isSelected
                                    ? "border-brand-prussian-blue bg-brand-prussian-blue text-white"
                                    : "border-black/10 bg-white text-brand-neutral-black"
                                }`}
                              >
                                {tag.value}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {error && (
              <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
                {error}
              </p>
            )}

            <Button
              type="button"
              onClick={handleEnrol}
              disabled={!childName.trim() || isSubmitting || !institutionId}
              className="mt-6 lg:w-auto"
            >
              {isSubmitting ? (isClinic ? "Adding…" : "Enrolling…") : isClinic ? "Add Client" : "Enrol Child"}
            </Button>
            <Link
              href="/principal/directory?segment=children"
              className="mt-2 block w-full lg:inline-block lg:w-auto rounded-2xl border border-black/10 px-6 py-3 text-center text-sm font-semibold text-black/60"
            >
              Cancel
            </Link>
          </>
        )}
      </main>
    </div>
  );
}
