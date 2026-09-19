-- PRD 8 Stage 2 -- a small, cosmetic gap found in the live browser pass:
-- the export screen's own header showed a blank child name for a
-- director (and, unconfirmed but the identical shape, would for a
-- school principal too) -- passports has no policy granting institution
-- staff a direct read of the row, matching this schema's own standing
-- rule ("roster-scoped child names always resolve through a dedicated
-- RPC, never a direct or embedded passports(...) read", this file's own
-- CLAUDE.md). The export screen was doing exactly the direct read that
-- rule warns against.
--
-- One small, reusable RPC rather than a passports policy change --
-- narrow to "a name, for staff whose own institution is genuinely
-- linked to this passport", nothing else.

create or replace function public.get_child_name_for_linked_institution_staff(p_passport_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select p.child_name
  from public.passports p
  where p.id = p_passport_id
    and exists (
      select 1
      from public.institution_staff s
      join public.passport_institution_links pil on pil.institution_id = s.institution_id
      where pil.passport_id = p_passport_id
        and s.user_id = auth.uid()
        and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
    );
$$;

grant execute on function public.get_child_name_for_linked_institution_staff(uuid) to authenticated;
