-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Widens get_my_passports() to also return passport_reference, so
-- /more can show a parent their child's Passport ID -- a plain,
-- non-security reference for identifying their child when they
-- contact the clinic, never an access credential. Same stored column
-- (passports.passport_reference, migration 0289) every clinic-side
-- caller already reads directly; this is the first parent-facing
-- reader of it. DROP+CREATE for the RETURNS TABLE shape change, per
-- this schema's own standing rule.
drop function if exists public.get_my_passports();

create function public.get_my_passports()
returns table (passport_id uuid, child_name text, passport_reference text)
language sql
security definer
set search_path = public
stable
as $$
  select g.passport_id, p.child_name, p.passport_reference
  from public.passport_guardians g
  join public.passports p on p.id = g.passport_id
  where g.user_id = auth.uid()
  order by p.child_name;
$$;

grant execute on function public.get_my_passports() to authenticated;
