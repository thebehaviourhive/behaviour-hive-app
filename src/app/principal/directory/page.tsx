"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { PrincipalBottomNav } from "@/components/principal/PrincipalBottomNav";
import { StaffList } from "@/components/principal/directory/StaffList";
import { StaffDetail, type StaffRow } from "@/components/principal/directory/StaffDetail";
import { ClassesList } from "@/components/principal/directory/ClassesList";
import { ClassDetail } from "@/components/principal/directory/ClassDetail";
import { ChildrenList } from "@/components/principal/directory/ChildrenList";
import { ChildDetail } from "@/components/principal/directory/ChildDetail";
import { TemporaryAccessList, type GrantRow } from "@/components/principal/directory/TemporaryAccessList";
import { TemporaryAccessDetail } from "@/components/principal/directory/TemporaryAccessDetail";
import { ClinicianList, type ClinicianRow } from "@/components/principal/directory/ClinicianList";
import { ClinicianCoverageDetail } from "@/components/principal/directory/ClinicianCoverageDetail";
import { useIsDesktopWidth } from "@/hooks/useIsDesktopWidth";

// PRD 4, Stage 4 -- the Directory split view. Replaces the old four-card
// menu (Staff/Classes/Passports/Temporary Access, each its own standalone
// route) with one consolidated page: a segmented control switches which
// segment's list renders, at every width. At lg+, selecting a row fills
// the right pane (8 columns) with that entity's detail, in place --
// Staff, Classes, Children and Temporary Access are DIFFERENT KINDS of
// case, all covered:
//
// - Classes and Children already had real detail ROUTES
//   (classes/[classId], passports/[passportId]) -- those routes are
//   kept, unchanged, for the 375px "tapping pushes to a detail screen"
//   case named in the brief. At lg+, the same row's click is
//   intercepted (preventDefault) and calls onSelect instead, so
//   selecting stays client state and never navigates away from this
//   page -- see ClassesList/ChildrenList's own header comments for why
//   this needs a runtime width check rather than being pure CSS.
// - Staff and Temporary Access never had a separate detail concept --
//   every row already showed its own full content and actions inline.
//   Below lg that's unchanged (StaffList/TemporaryAccessList render
//   full rows there); at lg+ the rows compact and the same actions move
//   into StaffDetail/TemporaryAccessDetail, the right pane.
//
// "Passports" is "Children" here, per Daniel's confirmation -- a
// rename, not a new surface. The four old standalone list pages
// (principal/staff, principal/classes, principal/passports,
// principal/temporary-access) are deleted this stage -- Directory folds
// four working destinations into one view, it doesn't build one
// alongside them; nothing else in the app links to their bare routes
// (checked before deleting).
//
// No SQL, no query changes -- every list/detail component here calls
// exactly the RPC its old standalone page already called.
//
// Fifth segment, Clinicians (bulk clinician assignment): a caseload
// view, not the child folder's own team view -- Daniel's own framing,
// kept literal. Two ways into the same right pane: selecting an
// already-engaged clinician from the left list (selectedClinician), or
// "Engage a New Clinician" (isEngagingNewClinician, no clinician object
// yet -- ClinicianCoverageDetail's own code-entry step resolves one).
// Mutually exclusive, both cleared on segment switch same as every
// other selection. The child folder's own Clinical Team section
// (ChildDetail.tsx, Children segment) is untouched -- connect/revoke
// stay there exactly as they were; both are legitimate views of the
// same clinician_access rows, per Daniel's own call.

type Segment = "staff" | "classes" | "children" | "temporary-access" | "clinicians";

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: "staff", label: "Staff" },
  { key: "classes", label: "Classes" },
  { key: "children", label: "Children" },
  { key: "temporary-access", label: "Temporary Access" },
  { key: "clinicians", label: "Clinicians" },
];

export default function PrincipalDirectoryPage() {
  const { user, isReady } = useRequireRole("principal");
  // Clinicians' detail has two render sites (mobile-stacked, desktop-
  // beside) -- gates which one actually mounts, see the hook's own
  // comment for why CSS-only hidden/lg:block isn't enough here.
  const isDesktopWidth = useIsDesktopWidth();
  const searchParams = useSearchParams();
  const [segment, setSegment] = useState<Segment>(() => {
    const requested = searchParams.get("segment");
    return SEGMENTS.some((s) => s.key === requested) ? (requested as Segment) : "staff";
  });
  const [institutionId, setInstitutionId] = useState<string | null>(null);

  const [selectedStaff, setSelectedStaff] = useState<StaffRow | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedPassportId, setSelectedPassportId] = useState<string | null>(null);
  const [selectedGrant, setSelectedGrant] = useState<GrantRow | null>(null);
  const [cutoffTime, setCutoffTime] = useState<string>("15:00:00");
  const [selectedClinician, setSelectedClinician] = useState<ClinicianRow | null>(null);
  const [isEngagingNewClinician, setIsEngagingNewClinician] = useState(false);
  const [clinicianRefreshToken, setClinicianRefreshToken] = useState(0);

  const [staffRefreshToken, setStaffRefreshToken] = useState(0);
  // ClassDetail/ChildDetail are both fully self-contained (own fetch,
  // own reload after any sheet resolves, matching CountersignCard's own
  // established shape) -- unlike Staff/Temporary Access, their detail
  // panes don't need a refresh signal pushed back to the list beside
  // them. The one residual gap: the list's own summary counts (e.g. a
  // class's teacher/child count) can go briefly stale until the next
  // full list reload if changed from the detail pane -- real, minor,
  // not fixed here; the same class of gap the Stage 1-3 recon already
  // named and left for the stage that actually owns it.
  const [temporaryAccessRefreshToken, setTemporaryAccessRefreshToken] = useState(0);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;
    async function loadInstitution() {
      const supabase = createClient();
      const { data } = await supabase
        .from("institution_staff")
        .select("institution_id")
        .eq("user_id", user!.id)
        .eq("role", "principal")
        .is("deactivated_at", null)
        .not("approved_at", "is", null)
        .maybeSingle();
      if (!isMounted) return;
      setInstitutionId(data?.institution_id ?? null);
    }
    loadInstitution();
    return () => {
      isMounted = false;
    };
  }, [user]);

  function switchSegment(next: Segment) {
    setSegment(next);
    setSelectedStaff(null);
    setSelectedClassId(null);
    setSelectedPassportId(null);
    setSelectedGrant(null);
    setSelectedClinician(null);
    setIsEngagingNewClinician(false);
  }

  if (!isReady) {
    return null;
  }

  const hasSelection =
    (segment === "staff" && selectedStaff) ||
    (segment === "classes" && selectedClassId) ||
    (segment === "children" && selectedPassportId) ||
    (segment === "temporary-access" && selectedGrant) ||
    (segment === "clinicians" && (selectedClinician || isEngagingNewClinician));

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="px-4 pt-6 pb-4">
        <h1 className="font-heading text-h1 font-bold text-brand-prussian-blue">Directory</h1>
      </header>

      <main className="flex-1 px-4 lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
        <div className="lg:col-span-4">
          {/* Segmented control -- Pastel Blue selected state, matching
              every other pill/segment control this PRD has introduced. */}
          <div className="mb-4 flex flex-wrap gap-2">
            {SEGMENTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => switchSegment(s.key)}
                className={`rounded-full border px-4 py-2 font-sans text-body font-semibold transition-colors ${
                  segment === s.key
                    ? "border-brand-pastel-blue bg-brand-pastel-blue text-brand-prussian-blue"
                    : "border-black/10 bg-white text-brand-neutral-black/70"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {segment === "staff" && (
            <StaffList
              currentUserId={user?.id}
              selectedUserId={selectedStaff?.user_id ?? null}
              onSelect={setSelectedStaff}
              refreshToken={staffRefreshToken}
            />
          )}
          {segment === "classes" && (
            <ClassesList
              institutionId={institutionId}
              selectedClassId={selectedClassId}
              onSelect={setSelectedClassId}
              refreshToken={0}
            />
          )}
          {segment === "children" && (
            <ChildrenList institutionId={institutionId} selectedPassportId={selectedPassportId} onSelect={setSelectedPassportId} />
          )}
          {segment === "temporary-access" && (
            <TemporaryAccessList
              institutionId={institutionId}
              selectedGrantId={selectedGrant?.grantId ?? null}
              onSelect={setSelectedGrant}
              onCutoffResolved={setCutoffTime}
              refreshToken={temporaryAccessRefreshToken}
            />
          )}
          {segment === "clinicians" && (
            <ClinicianList
              institutionId={institutionId}
              selectedClinicianId={selectedClinician?.clinicianId ?? null}
              onSelect={(c) => {
                setSelectedClinician(c);
                setIsEngagingNewClinician(false);
              }}
              onEngageNew={() => {
                setSelectedClinician(null);
                setIsEngagingNewClinician(true);
              }}
              refreshToken={clinicianRefreshToken}
            />
          )}

          {/* Below lg, the right pane (below) is hidden entirely --
              Staff/Temporary Access solve this by rendering full detail
              INLINE in their own list rows; Classes/Children solve it
              with a real detail route. Clinicians has neither (the
              coverage checklist is real interactive content, not a
              route), so it renders here instead, directly under the
              list, stacked instead of side-by-side.
              !isDesktopWidth gates this in JS, not just lg:hidden in
              CSS -- ClinicianCoverageDetail has its own static element
              ids (the select-all checkbox, one per row); CSS-hidden
              still means MOUNTED, so at desktop width both this block
              and the lg:block one below would render the same ids
              twice in one DOM at once. Found live during browser
              verification (a Playwright locator resolved two matches
              for the same child's checkbox). useIsDesktopWidth() makes
              sure exactly one copy is ever mounted. */}
          {segment === "clinicians" && institutionId && isEngagingNewClinician && !isDesktopWidth && (
            <div className="mt-4">
              <ClinicianCoverageDetail
                institutionId={institutionId}
                mode="new"
                onCoverageChanged={() => setClinicianRefreshToken((n) => n + 1)}
              />
            </div>
          )}
          {segment === "clinicians" && institutionId && selectedClinician && !isDesktopWidth && (
            <div className="mt-4">
              <ClinicianCoverageDetail
                institutionId={institutionId}
                mode="existing"
                clinician={selectedClinician}
                onCoverageChanged={() => setClinicianRefreshToken((n) => n + 1)}
              />
            </div>
          )}
        </div>

        <div className="mt-6 hidden lg:col-span-8 lg:mt-0 lg:block">
          {!hasSelection ? (
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
              <p className="font-sans text-body text-brand-neutral-black/60">Select an entry from the list to see its detail.</p>
            </div>
          ) : segment === "staff" && selectedStaff && institutionId ? (
            <StaffDetail
              member={selectedStaff}
              institutionId={institutionId}
              isSelf={selectedStaff.user_id === user?.id}
              onChanged={() => setStaffRefreshToken((n) => n + 1)}
            />
          ) : segment === "classes" && selectedClassId ? (
            <div className="rounded-2xl bg-white p-6 shadow-sm">
              <ClassDetail classId={selectedClassId} />
            </div>
          ) : segment === "children" && selectedPassportId ? (
            // No p-6 here, unlike the other three -- ChildDetail owns
            // its own horizontal AND vertical padding internally (its
            // tab-strip needs independent spacing from the content
            // below it), so wrapping it in a padded card would double
            // up. overflow-hidden keeps its own rounded tab-strip
            // border from poking past this card's own corners.
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
              <ChildDetail passportId={selectedPassportId} />
            </div>
          ) : segment === "temporary-access" && selectedGrant && institutionId ? (
            <TemporaryAccessDetail
              grant={selectedGrant}
              institutionId={institutionId}
              cutoffTime={cutoffTime}
              // Selection deliberately stays put after a revoke -- the
              // pane now refreshes its own state directly (see
              // TemporaryAccessDetail's own header comment) and shows
              // "Revoked" in place, rather than the old
              // setSelectedGrant(null) that unmounted it and made
              // correctness depend on that unmount instead of a real
              // refresh.
              onRevoked={() => setTemporaryAccessRefreshToken((n) => n + 1)}
            />
          ) : segment === "clinicians" && institutionId && isEngagingNewClinician && isDesktopWidth ? (
            <ClinicianCoverageDetail
              institutionId={institutionId}
              mode="new"
              onCoverageChanged={() => setClinicianRefreshToken((n) => n + 1)}
            />
          ) : segment === "clinicians" && institutionId && selectedClinician && isDesktopWidth ? (
            <ClinicianCoverageDetail
              institutionId={institutionId}
              mode="existing"
              clinician={selectedClinician}
              onCoverageChanged={() => setClinicianRefreshToken((n) => n + 1)}
            />
          ) : null}
        </div>
      </main>

      <PrincipalBottomNav />
    </div>
  );
}
