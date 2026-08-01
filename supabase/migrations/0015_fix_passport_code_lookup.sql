/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   Same chicken-and-egg RLS shape as the institution code lookup: a
   teacher needs to look up a passport by its passport_code BEFORE any
   passport_access row exists (that's the entire point of the Add Child
   flow), but passports' only SELECT policies require either being the
   parent or already having that relationship. Confirmed via a real
   teacher session: looking up a known-valid code returned an empty
   array, not an error.

   Unlike the institutions fix, this one should NOT just open SELECT on
   passports broadly -- that table holds real sensitive data (diagnoses,
   important people, etc.), and a blanket "authenticated can read" policy
   would let any teacher browse every family's full passport, not just
   verify a code they already have in hand. Instead, a SECURITY DEFINER
   function does the lookup server-side and returns only the three fields
   the Add Child flow actually needs (id, child_name, passport_code_active)
   for the one row matching the exact code -- everything else on that row
   stays invisible regardless of who calls it. */

create or replace function public.lookup_passport_by_code(code text)
returns table (id uuid, child_name text, passport_code_active boolean)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.child_name, p.passport_code_active
  from public.passports p
  where p.passport_code ilike code
  limit 1;
$$;

grant execute on function public.lookup_passport_by_code(text) to authenticated;
