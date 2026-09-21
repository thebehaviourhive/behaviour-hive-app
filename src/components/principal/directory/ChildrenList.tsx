"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BookUser, User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ClinicalFileIcon } from "@/components/ui/icons";
import type { InstitutionType } from "@/lib/institutionType";
import { DischargeEpisodeSheet } from "@/components/principal/DischargeEpisodeSheet";
import { ReopenEpisodeSheet } from "@/components/principal/ReopenEpisodeSheet";

type ChildrenSegment = "active" | "past";

interface ChildStatusBadges {
  sectionAComplete: boolean;
  hasActiveClinician: boolean;
  hasClaimedGuardian: boolean;
}

// Stage 7, item 1 -- at-a-glance status on each card: passport filled,
// clinician connected, parent claimed. Daniel's own accessibility
// instruction, built in from the start rather than color alone: a
// filled disc vs. a hollow ring is a SHAPE difference, not a hue one --
// readable regardless of colour vision -- and every badge carries an
// aria-label naming both what it is and its current state, not just an
// icon a sighted principal has to already know how to read. The one-
// time legend row above the list (not per-row) is what actually answers
// "what does a grey icon mean without hovering" -- three icons with
// visible labels, in the same fixed left-to-right order the per-row
// badges use, seen once rather than re-explained on every card.
//
// Follow-up, same stage: the three complete-state fills were all
// Prussian Blue -- indistinguishable from each other at a glance, the
// exact thing the legend/aria-label pair exists to make unnecessary to
// check individually. Now colour-coded (Passport = Golden Brown,
// Clinician = stays Prussian Blue, Parent = Pastel Blue), each carried
// as its own `completeClassName` here rather than the one shared string
// StatusBadge/StatusBadgeLegend used to hard-code, so the card row and
// the legend can never drift out of sync with each other.
//
// Pastel Blue (#BAD9EB) checked for legibility once filled, not
// assumed: computed contrast of a WHITE icon against that fill is
// ~1.5:1 -- far below the 3:1 WCAG minimum for a graphical/UI element,
// and visually confirmed as "barely-there", not "filled". Fixed with
// the two things Daniel's own brief named as the likely fix -- a
// darker outline (a solid 2px Prussian Blue border, replacing the
// implicit borderless fill the other two complete states use) AND a
// darker icon (Prussian Blue, not white -- computed contrast against
// the same fill is ~6:1, comfortably over the 3:1 minimum). This is
// also why Parent's complete state is the one exception with a visible
// border: it needs one to read as filled at all; Passport and Clinician
// don't. The shape rule itself (solid fill vs. dashed hollow ring) is
// untouched by any of this -- still true with three fill colours, not
// just the original one, since it was never carried by hue to begin
// with.
const STATUS_BADGE_DEFS: {
  key: keyof ChildStatusBadges;
  label: string;
  completeLabel: string;
  incompleteLabel: string;
  completeClassName: string;
  icon: (props: { className?: string }) => React.ReactElement;
}[] = [
  {
    key: "sectionAComplete",
    label: "Passport",
    completeLabel: "Passport completed",
    incompleteLabel: "Passport not yet completed",
    completeClassName: "bg-brand-golden-brown text-white",
    icon: (props) => <BookUser {...props} strokeWidth={2} />,
  },
  {
    key: "hasActiveClinician",
    label: "Clinician",
    completeLabel: "Clinician connected",
    incompleteLabel: "No clinician connected",
    completeClassName: "bg-brand-prussian-blue text-white",
    icon: (props) => <ClinicalFileIcon {...props} />,
  },
  {
    key: "hasClaimedGuardian",
    label: "Parent",
    completeLabel: "Parent claimed",
    incompleteLabel: "Not yet claimed by a parent",
    // Pastel Blue's own low contrast needs both a darker border AND a
    // darker icon to read as filled -- see the header comment above.
    completeClassName: "border-2 border-brand-prussian-blue bg-brand-pastel-blue text-brand-prussian-blue",
    icon: (props) => <User {...props} strokeWidth={2} />,
  },
];

function StatusBadge({
  def,
  isComplete,
}: {
  def: (typeof STATUS_BADGE_DEFS)[number];
  isComplete: boolean;
}) {
  const Icon = def.icon;
  return (
    <span
      role="img"
      aria-label={isComplete ? def.completeLabel : def.incompleteLabel}
      title={isComplete ? def.completeLabel : def.incompleteLabel}
      className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${
        isComplete ? def.completeClassName : "border border-dashed border-black/20 bg-transparent text-black/30"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

function StatusBadgeRow({ badges }: { badges: ChildStatusBadges | undefined }) {
  return (
    <div className="mt-2 flex items-center gap-1.5">
      {STATUS_BADGE_DEFS.map((def) => (
        <StatusBadge key={def.key} def={def} isComplete={Boolean(badges?.[def.key])} />
      ))}
    </div>
  );
}

// Seen once, above the list -- not re-explained per row. Same fixed
// order as StatusBadgeRow, and now the same per-badge completeClassName
// too, so the legend's own swatches show the real colour each card
// badge will actually use rather than a single generic example.
function StatusBadgeLegend() {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-sans text-xs text-brand-neutral-black/50">
      {STATUS_BADGE_DEFS.map((def) => {
        const Icon = def.icon;
        return (
          <span key={def.key} className="flex items-center gap-1.5">
            <span
              className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${def.completeClassName}`}
            >
              <Icon className="h-3 w-3" />
            </span>
            {def.label}
          </span>
        );
      })}
    </div>
  );
}

// PRD 4, Stage 4 -- extracted from principal/passports/page.tsx.
// "Passports" renamed to "Children" here, per Daniel's confirmation --
// a rename, in scope, no surface change. Same Link+preventDefault
// pattern as ClassesList: a real push to /principal/passports/[id]
// below lg (unchanged), intercepted into onSelect at lg+.
//
// Stage 7, item 2 -- Past Pupils was a collapsed accordion under the
// active list; now a proper second, independently selectable list, same
// pill-segment pattern the Directory page itself already uses
// (principal/directory/page.tsx's own Staff/Classes/Children/Temporary
// Access/Clinicians selector) rather than a third UI convention. Both
// segments share the one search query already in state -- typing
// filters whichever list is currently selected, same as before. A past
// pupil's own file was already confirmed to render correctly
// (ChildDetail.tsx has no enrolment-status filter on its own roster
// check, only on its two write actions) -- this is a pure UI
// restructuring, no data-layer change.
//
// Tier 1 items 1 and 3, 21 Sept 2026 -- a clinic client's own "active
// vs discharged" split can never come from get_institution_child_
// roster()'s enrolment_ended_at (sourced from `enrolments`, a table a
// clinic client never has a row in) -- so at a clinic this now loads
// from get_institution_episode_roster(instId, true) instead, the same
// clinic-only table tags/scope/discharge/the stagnation queue all key
// off. Discharge (end_clinic_episode) and Reopen (reopen_clinic_
// episode) are both real actions here now too -- both existed with
// zero client callers before this.
interface RosterRow {
  passportId: string;
  childName: string;
  endedAt: string | null;
  episodeId: string | null;
  endReason: string | null;
}

export function ChildrenList({
  institutionId,
  institutionType,
  selectedPassportId,
  onSelect,
}: {
  institutionId: string | null;
  institutionType: InstitutionType;
  selectedPassportId: string | null;
  onSelect: (passportId: string) => void;
}) {
  const isClinic = institutionType === "clinic";
  const CHILDREN_SEGMENTS: { key: ChildrenSegment; label: string }[] = isClinic
    ? [
        { key: "active", label: "Active" },
        { key: "past", label: "Discharged" },
      ]
    : [
        { key: "active", label: "Active" },
        { key: "past", label: "Past Pupils" },
      ];

  const [children, setChildren] = useState<RosterRow[]>([]);
  const [badgesByPassportId, setBadgesByPassportId] = useState<Map<string, ChildStatusBadges>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<ChildrenSegment>("active");

  const [dischargeTarget, setDischargeTarget] = useState<RosterRow | null>(null);
  const [reopenTarget, setReopenTarget] = useState<RosterRow | null>(null);

  const load = useCallback(
    async (instId: string) => {
      setIsLoading(true);
      setError(null);
      const supabase = createClient();

      if (isClinic) {
        const { data, error: rpcError } = await supabase.rpc("get_institution_episode_roster", {
          p_institution_id: instId,
          p_include_ended: true,
        });
        if (rpcError) {
          setError("Could not load your clinic's own client list.");
          setIsLoading(false);
          return;
        }
        setChildren(
          (
            (data ?? []) as { episode_id: string; passport_id: string; child_name: string; ended_at: string | null; end_reason: string | null }[]
          )
            .map((r) => ({
              passportId: r.passport_id,
              childName: r.child_name,
              endedAt: r.ended_at,
              episodeId: r.episode_id,
              endReason: r.end_reason,
            }))
            .sort((a, b) => a.childName.localeCompare(b.childName))
        );
        setIsLoading(false);
        return;
      }

      const [rosterResult, badgesResult] = await Promise.all([
        supabase.rpc("get_institution_child_roster", { p_institution_id: instId }),
        supabase.rpc("get_institution_child_status_badges", { p_institution_id: instId }),
      ]);
      if (rosterResult.error) {
        setError(isClinic ? "Could not load the clinic roster." : "Could not load the school roster.");
        setIsLoading(false);
        return;
      }
      setChildren(
        ((rosterResult.data ?? []) as { passport_id: string; child_name: string; enrolment_ended_at: string | null }[])
          .map((r) => ({
            passportId: r.passport_id,
            childName: r.child_name,
            endedAt: r.enrolment_ended_at,
            episodeId: null,
            endReason: null,
          }))
          .sort((a, b) => a.childName.localeCompare(b.childName))
      );
      // Secondary read -- a failure here doesn't block the roster itself
      // from rendering, badges just fall back to "incomplete" (every
      // StatusBadge already renders its own not-yet state for an unknown
      // passport id, since badgesByPassportId.get() returns undefined).
      if (badgesResult.error) {
        console.error("Failed to load child status badges:", badgesResult.error);
      } else {
        const map = new Map<string, ChildStatusBadges>();
        for (const row of (badgesResult.data ?? []) as {
          passport_id: string;
          section_a_complete: boolean;
          has_active_clinician: boolean;
          has_claimed_guardian: boolean;
        }[]) {
          map.set(row.passport_id, {
            sectionAComplete: row.section_a_complete,
            hasActiveClinician: row.has_active_clinician,
            hasClaimedGuardian: row.has_claimed_guardian,
          });
        }
        setBadgesByPassportId(map);
      }
      setIsLoading(false);
    },
    [isClinic]
  );

  useEffect(() => {
    if (!institutionId) return;
    async function run() {
      await load(institutionId!);
    }
    run();
  }, [institutionId, load]);

  const active = children.filter((c) => !c.endedAt);
  const past = children.filter((c) => c.endedAt);
  const filteredActive = query.trim()
    ? active.filter((c) => c.childName.toLowerCase().includes(query.trim().toLowerCase()))
    : active;
  const filteredPast = query.trim()
    ? past.filter((c) => c.childName.toLowerCase().includes(query.trim().toLowerCase()))
    : past;

  function formatDate(value: string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function rowLink(c: RosterRow, muted: boolean) {
    return (
      <Link
        key={c.passportId}
        href={`/principal/passports/${c.passportId}`}
        onClick={(e) => {
          if (window.matchMedia("(min-width: 1024px)").matches) {
            e.preventDefault();
            onSelect(c.passportId);
          }
        }}
        className={`block rounded-2xl border p-4 shadow-sm ${
          c.passportId === selectedPassportId
            ? "border-brand-prussian-blue bg-brand-pastel-blue/10"
            : muted
              ? "border-black/5 bg-white/60"
              : "border-black/5 bg-white"
        }`}
      >
        <p className="font-heading text-h2 font-semibold text-brand-prussian-blue lg:text-body lg:font-semibold lg:text-brand-neutral-black">
          {c.childName}
        </p>
        {!isClinic && <StatusBadgeRow badges={badgesByPassportId.get(c.passportId)} />}
      </Link>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        {children.length > 0 && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            className="w-full rounded-xl border border-brand-off-white bg-white px-4 py-2 font-sans text-body text-brand-neutral-black placeholder:text-brand-neutral-black/40 focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
          />
        )}
        {institutionId && (
          <Link
            href="/principal/passports/enrol"
            className="flex-shrink-0 rounded-full bg-brand-prussian-blue px-4 py-2 font-sans text-body font-semibold text-white"
          >
            {isClinic ? "+ Add Client" : "+ Enrol"}
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
        </div>
      ) : error ? (
        <p className="font-sans text-body text-brand-neutral-black/60">{error}</p>
      ) : children.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
          {isClinic ? "No clients linked to this clinic yet." : "No children linked to this school yet."}
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {CHILDREN_SEGMENTS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSegment(s.key)}
                aria-pressed={segment === s.key}
                className={`rounded-full border px-4 py-2 font-sans text-body font-semibold transition-colors ${
                  segment === s.key
                    ? "border-brand-pastel-blue bg-brand-pastel-blue text-brand-prussian-blue"
                    : "border-black/10 bg-white text-brand-neutral-black/70"
                }`}
              >
                {s.label} ({s.key === "active" ? filteredActive.length : filteredPast.length})
              </button>
            ))}
          </div>

          {!isClinic && <StatusBadgeLegend />}

          {segment === "active" ? (
            filteredActive.length === 0 ? (
              <p className="px-1 pt-2 text-center font-sans text-body text-brand-neutral-black/60">
                {query.trim()
                  ? `No currently ${isClinic ? "active clients" : "enrolled children"} match "${query}".`
                  : isClinic
                    ? "No clients currently active."
                    : "No children currently enrolled."}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {filteredActive.map((c) => (
                  <div key={c.passportId}>
                    {rowLink(c, false)}
                    {isClinic && (
                      <button
                        type="button"
                        onClick={() => setDischargeTarget(c)}
                        className="mt-1 px-1 font-sans text-eyebrow font-semibold text-brand-golden-brown"
                      >
                        Discharge
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : filteredPast.length === 0 ? (
            <p className="px-1 pt-2 text-center font-sans text-body text-brand-neutral-black/60">
              {query.trim()
                ? `No ${isClinic ? "discharged clients" : "past pupils"} match "${query}".`
                : isClinic
                  ? "No discharged clients."
                  : "No past pupils."}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredPast.map((c) => (
                <div key={c.passportId}>
                  {rowLink(c, true)}
                  <p className="mt-0.5 px-1 font-sans text-eyebrow text-brand-neutral-black/50">
                    {isClinic ? "Discharged" : "Enrolment ended"} {formatDate(c.endedAt!)}
                    {isClinic && c.endReason ? ` · ${c.endReason}` : ""}
                  </p>
                  {isClinic && (
                    <button
                      type="button"
                      onClick={() => setReopenTarget(c)}
                      className="mt-1 px-1 font-sans text-eyebrow font-semibold text-brand-prussian-blue"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {dischargeTarget && institutionId && (
        <DischargeEpisodeSheet
          isOpen={Boolean(dischargeTarget)}
          episodeId={dischargeTarget.episodeId!}
          institutionId={institutionId}
          childName={dischargeTarget.childName}
          onClose={() => setDischargeTarget(null)}
          onDischarged={() => {
            setDischargeTarget(null);
            load(institutionId);
          }}
        />
      )}

      {reopenTarget && institutionId && (
        <ReopenEpisodeSheet
          isOpen={Boolean(reopenTarget)}
          institutionId={institutionId}
          passportId={reopenTarget.passportId}
          childName={reopenTarget.childName}
          onClose={() => setReopenTarget(null)}
          onReopened={() => {
            setReopenTarget(null);
            load(institutionId);
          }}
        />
      )}
    </>
  );
}
