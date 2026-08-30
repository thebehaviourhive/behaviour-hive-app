-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 2, Stage 4 -- the principal's Clinical tab needs a "Previous
-- Clinicians" accordion (revoked or stepped-back engagements: name,
-- role, date ended, reason), and there is nowhere to read that from.
-- clinician_access (0026) has always had revoked_at/revoked_by/
-- revocation_reason/is_active (0123 added the first three); the data
-- exists. get_passport_clinicians() (0124) just filters to
-- is_active = true and never selects the revoke columns at all.
--
-- Deliberately a NEW function, not a widen of get_passport_clinicians()
-- itself. Checked every existing caller first: src/app/passport/
-- dashboard/page.tsx, src/components/parent/ClinicalSupportSection.tsx,
-- src/components/parent/calm/CalmUnlockSheet.tsx, and
-- src/app/passport/fba/[fbaId]/print/page.tsx all treat every row that
-- function returns as a currently-connected clinician -- none of them
-- check is_active. Widening the column list to include revoked rows
-- would silently hand all four a stale/revoked clinician as if they
-- were still connected (CalmUnlockSheet deciding Calm Cards are
-- unlocked by a clinician who no longer has access, being the sharpest
-- version of that). Not touched.
--
-- Same two authorities as get_passport_clinicians() (owns_passport()
-- for a parent, or a principal at an institution the passport is
-- linked to) -- history is symmetric with the live list, even though
-- only the principal screen consumes it today. Explicitly institution-
-- scoped via p_institution_id, though -- matching get_passport_access_
-- for_child()'s and get_passport_guardians_for_child()'s own
-- convention rather than get_passport_clinicians()'s more implicit
-- "any institution the caller happens to be principal of that's linked
-- to this passport" check; the client always has its own institutionId
-- in scope already, so there's no reason to be less specific here.
-- Unlike the live list, this does NOT filter on the clinician's current
-- verification_status -- a past engagement is a historical fact, not a
-- claim about whether that clinician could act today.

create function public.get_passport_clinician_history(p_passport_id uuid, p_institution_id uuid)
returns table (
  clinician_access_id uuid,
  clinician_id uuid,
  full_name text,
  specialty text,
  engaged_by text,
  engaged_by_institution_id uuid,
  engaged_by_institution_name text,
  linked_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    ca.id, ca.clinician_id, c.full_name, c.specialty,
    ca.engaged_by, ca.engaged_by_institution_id, inst.name,
    ca.linked_at, ca.revoked_at, ca.revocation_reason
  from public.clinician_access ca
  join public.clinicians c on c.user_id = ca.clinician_id
  left join public.institutions inst on inst.id = ca.engaged_by_institution_id
  where ca.passport_id = p_passport_id
    and ca.is_active = false
    and (
      public.owns_passport(p_passport_id)
      or exists (
        select 1 from public.passport_institution_links pil
        join public.institution_staff s on s.institution_id = pil.institution_id
        where pil.passport_id = p_passport_id
          and s.institution_id = p_institution_id
          and s.user_id = auth.uid()
          and s.role = 'principal'
          and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
      )
    )
  order by ca.revoked_at desc;
$$;

grant execute on function public.get_passport_clinician_history(uuid, uuid) to authenticated;
