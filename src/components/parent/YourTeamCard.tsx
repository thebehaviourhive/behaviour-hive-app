"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PeopleIcon } from "@/components/ui/icons";

interface TeamMember {
  teacherId: string;
  fullName: string;
  role: string;
}

const ROLE_STYLE: Record<string, string> = {
  clinician: "bg-brand-golden-brown/10 text-brand-golden-brown",
};
const ROLE_LABEL: Record<string, string> = {
  class_teacher: "Teacher",
  clinician: "Clinician",
};

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getLastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] ?? fullName;
}

function sortTeam(members: TeamMember[]): TeamMember[] {
  return [...members].sort((a, b) => {
    const aIsTeacher = a.role === "class_teacher" ? 0 : 1;
    const bIsTeacher = b.role === "class_teacher" ? 0 : 1;
    if (aIsTeacher !== bIsTeacher) return aIsTeacher - bIsTeacher;
    return getLastName(a.fullName).localeCompare(getLastName(b.fullName));
  });
}

export function YourTeamCard({ passportId }: { passportId: string | null }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!passportId) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data } = await supabase.rpc("get_passport_team", {
        p_passport_id: passportId,
      });

      if (!isMounted) return;

      const rows: TeamMember[] = (data ?? []).map(
        (row: { teacher_id: string; full_name: string | null; role: string }) => ({
          teacherId: row.teacher_id,
          fullName: row.full_name || "A team member",
          role: row.role,
        })
      );
      setMembers(sortTeam(rows));
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [passportId]);

  const visibleMembers = isExpanded ? members : members.slice(0, 3);
  const remaining = members.length - 3;

  return (
    <section className="mb-8 rounded-2xl border border-brand-off-white/50 bg-white p-5 shadow-sm">
      <h2 className="mb-4 font-heading text-xl font-bold text-brand-prussian-blue">
        Your Team
      </h2>

      {isLoading ? (
        <>
          <TeamRowSkeleton />
          <TeamRowSkeleton />
        </>
      ) : members.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-brand-safe-ivory/30 p-4 text-center">
          <PeopleIcon className="h-8 w-8 text-brand-prussian-blue/60" />
          <p className="font-sans text-sm text-brand-neutral-black/80">
            It takes a village! When teachers or clinicians link to your
            child&apos;s passport, they will appear right here.
          </p>
        </div>
      ) : (
        <>
          {visibleMembers.map((member) => (
            <div
              key={member.teacherId}
              className="flex items-center gap-4 border-b border-brand-off-white/50 py-3 last:border-0"
            >
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-pastel-blue/40 font-heading text-lg font-bold text-brand-prussian-blue">
                {getInitials(member.fullName)}
              </span>
              <div>
                <p className="font-sans text-base font-bold text-brand-neutral-black">
                  {member.fullName}
                </p>
                <span
                  className={`mt-1 inline-block w-max rounded-full px-2 py-0.5 font-accent text-[10px] font-bold uppercase tracking-wide ${
                    ROLE_STYLE[member.role] ??
                    "bg-brand-pastel-blue/20 text-brand-prussian-blue"
                  }`}
                >
                  {ROLE_LABEL[member.role] ?? "Teacher"}
                </span>
              </div>
            </div>
          ))}

          {!isExpanded && remaining > 0 && (
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="mt-2 w-full text-center font-sans text-sm font-bold text-brand-prussian-blue"
            >
              + View all ({members.length}) members
            </button>
          )}
        </>
      )}
    </section>
  );
}

function TeamRowSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-4 border-b border-brand-off-white/50 py-3 last:border-0">
      <span className="h-10 w-10 flex-shrink-0 rounded-full bg-brand-off-white" />
      <div className="flex flex-1 flex-col gap-1.5">
        <span className="h-4 w-32 rounded bg-brand-off-white" />
        <span className="h-3 w-16 rounded bg-brand-off-white" />
      </div>
    </div>
  );
}
