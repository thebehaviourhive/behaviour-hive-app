-- Structural gate for the class-derived access drift found in the 15
-- Sept 2026 QA pass (see 0188's own header comment). Group A was two
-- functions that never called has_child_access() at all. This is the
-- check that catches the NEXT one of those at commit time -- it does
-- NOT catch Group B's failure mode (a function that calls has_child_
-- access() correctly today and drifts when a fifth branch lands later).
--
-- list_functions_referencing_passport_access() returns every function
-- in the public schema whose LIVE body -- pg_get_functiondef(), read
-- from pg_proc at call time, not a migration file -- references
-- public.passport_access directly. Migration file text is not trusted
-- here on principle: this session's own first attempt to audit this by
-- hand grepped raw .sql files and wrongly flagged the passports table's
-- SELECT policy as still broken, because 0104 fixed it via ALTER POLICY
-- rather than DROP+CREATE, which a plain grep across files doesn't
-- track. A function that's been fixed since the migration that first
-- wrote it will show its CURRENT body here, correctly, however many
-- times it's been replaced.
--
-- The regex specifically matches "public.passport_access" (schema-
-- qualified), not the bare word -- every real reference to the table in
-- this codebase is schema-qualified (checked directly: zero exceptions
-- across every migration), while several functions mention the bare
-- word "passport_access" only in a comment explaining an unrelated
-- decision (create_school_passport is one such case). Matching the
-- qualified form is what keeps this check from crying wolf on prose.
create or replace function public.list_functions_referencing_passport_access()
returns table (
  function_name text,
  arguments text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.proname::text as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    -- excludes itself: its OWN body contains the literal string
    -- "public.passport_access" as part of this comment and the regex
    -- pattern below, which would otherwise make it flag itself on
    -- every run.
    and p.proname <> 'list_functions_referencing_passport_access'
    and pg_get_functiondef(p.oid) ~ 'public\.passport_access\M'
  order by p.proname;
$$;

-- Service-role only -- this exposes internal function source text, and
-- the one caller is the adversarial suite's own service-role client.
revoke all on function public.list_functions_referencing_passport_access() from public;
grant execute on function public.list_functions_referencing_passport_access() to service_role;
