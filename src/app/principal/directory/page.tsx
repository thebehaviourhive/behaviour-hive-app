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

type Segment = "staff" | "classes" | "children" | "temporary-access";

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: "staff", label: "Staff" },
  { key: "classes", label: "Classes" },
  { key: "children", label: "Children" },
  { key: "temporary-access", label: "Temporary Access" },
];

export default function PrincipalDirectoryPage() {
  const { user, isReady } = useRequireRole("principal");
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
  }

  if (!isReady) {
    return null;
  }

  const hasSelection =
    (segment === "staff" && selectedStaff) ||
    (segment === "classes" && selectedClassId) ||
    (segment === "children" && selectedPassportId) ||
    (segment === "temporary-access" && selectedGrant);

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
        </div>

        <div className="mt-6 hidden lg:col-span-8 lg:mt-0 lg:block">
          {!hasSelection ? (
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
              <p className="font-sans text-body text-brand-neutral-black/60">Select an entry from the list to see its detail.</p>
            </div>
          ) : segment === "staff" && selectedStaff ? (
            <StaffDetail
              member={selectedStaff}
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
          ) : segment === "temporary-access" && selectedGrant ? (
            <TemporaryAccessDetail
              grant={selectedGrant}
              cutoffTime={cutoffTime}
              onRevoked={() => {
                setSelectedGrant(null);
                setTemporaryAccessRefreshToken((n) => n + 1);
              }}
            />
          ) : null}
        </div>
      </main>

      <PrincipalBottomNav />
    </div>
  );
}
