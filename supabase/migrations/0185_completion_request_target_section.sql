-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- MEDICAL AND INTIMATE CARE NEEDS -- delivery. Decided: "the parent, via
-- exactly the existing passport completion request." Checked that
-- system's live definition (0143) before reusing it: it is hardcoded to
-- Section A specifically -- both "outstanding" derivations check
-- passports.section_a_complete directly, and the prompt card links
-- straight to /passport/section-a. Reused as-is, it would not work at
-- all for Section E: every passport that already has section_a_complete
-- = true (which is most real passports, immediately, since Section E
-- never existed before now) would show nothing outstanding no matter
-- how many times a teacher asked for the new fields specifically.
--
-- Generalised with a target_section column rather than a second,
-- parallel ledger table -- the SAME request/ledger shape now points at
-- either Section A or Section E, same "outstanding derives from the
-- passport's own field, never a tracked status" philosophy the table's
-- own original comment already committed to, just checking
-- passport_section_e.section_e_complete instead of passports.
-- section_a_complete when target_section = 'e'.
--
-- Unique constraint widened to (passport_id, recipient_id,
-- target_section) -- a guardian can legitimately be asked for BOTH
-- Section A and Section E at once, or Section E later once A is long
-- done; the old (passport_id, recipient_id) pair would have wrongly
-- treated those as duplicates of the same request.
--
-- request_passport_completion() grows a new trailing parameter --
-- DROP + CREATE for every existing signature, not bare CREATE OR
-- REPLACE, per the standing rule (a bare add creates a second, silent
-- overload rather than replacing the original).

alter table public.passport_completion_requests
  add column if not exists target_section text not null default 'a'
    check (target_section in ('a', 'e'));

-- Looked up dynamically rather than guessed by Postgres's default
-- naming convention -- the original (passport_id, recipient_id) unique
-- constraint's real name is confirmed from pg_constraint itself here,
-- not assumed, so this can't silently no-op against a differently-named
-- constraint and leave the old, now-too-strict pair enforced alongside
-- the new one.
do $$
declare
  v_old_constraint_name text;
begin
  select con.conname into v_old_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'passport_completion_requests'
    and con.contype = 'u'
    -- Set comparison (sorted arrays), not conkey's own definition
    -- order -- a unique constraint is defined by which columns it
    -- covers, not the order they were listed in.
    and (select array_agg(x order by x) from unnest(con.conkey) x)
      = (
        select array_agg(attnum order by attnum)
        from pg_attribute
        where attrelid = rel.oid
          and attname in ('passport_id', 'recipient_id')
      );

  if v_old_constraint_name is not null then
    execute format('alter table public.passport_completion_requests drop constraint %I', v_old_constraint_name);
  end if;
end;
$$;

alter table public.passport_completion_requests
  add constraint passport_completion_requests_passport_recipient_section_key
  unique (passport_id, recipient_id, target_section);

drop function if exists public.request_passport_completion(uuid, uuid);

create function public.request_passport_completion(
  p_passport_id uuid,
  p_institution_id uuid,
  p_target_section text default 'a'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if p_target_section not in ('a', 'e') then
    raise exception 'Unknown section.';
  end if;

  if not public.institution_staff_has_current_standing(auth.uid(), p_institution_id) then
    raise exception 'Only an active member of staff at this school can request this.';
  end if;

  if not exists (
    select 1 from public.passport_access pa
    where pa.passport_id = p_passport_id
      and pa.institution_id = p_institution_id
      and pa.teacher_id = auth.uid()
      and pa.is_active = true
  ) then
    raise exception 'You need access to this child''s passport before you can request this.';
  end if;

  if not exists (
    select 1 from public.passport_guardians g where g.passport_id = p_passport_id
  ) then
    raise exception 'This child has no guardian to notify yet.';
  end if;

  insert into public.passport_completion_requests (
    passport_id, institution_id, requested_by, recipient_id, target_section
  )
  select p_passport_id, p_institution_id, auth.uid(), g.user_id, p_target_section
  from public.passport_guardians g
  where g.passport_id = p_passport_id
    and not exists (
      select 1 from public.passport_completion_requests r
      where r.passport_id = p_passport_id
        and r.recipient_id = g.user_id
        and r.target_section = p_target_section
    );

  get diagnostics v_created = row_count;

  if v_created = 0 then
    raise exception 'This has already been requested from every current guardian on this passport.';
  end if;

  return v_created;
end;
$$;

grant execute on function public.request_passport_completion(uuid, uuid, text) to authenticated;

-- get_my_passport_completion_requests() -- the parent's own feed.
-- "Outstanding" now branches on target_section: Section A checks
-- passports.section_a_complete (unchanged), Section E checks
-- passport_section_e.section_e_complete via a left join (no row at all
-- reads as "not complete", same as every other not-yet-started section
-- in this schema).
drop function if exists public.get_my_passport_completion_requests();

create function public.get_my_passport_completion_requests()
returns table (
  id uuid,
  passport_id uuid,
  child_name text,
  institution_name text,
  target_section text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.passport_id,
    p.child_name,
    i.name as institution_name,
    r.target_section,
    r.created_at
  from public.passport_completion_requests r
  join public.passports p on p.id = r.passport_id
  join public.institutions i on i.id = r.institution_id
  left join public.passport_section_e se on se.passport_id = r.passport_id
  where r.recipient_id = auth.uid()
    and (
      (r.target_section = 'a' and coalesce(p.section_a_complete, false) = false)
      or (r.target_section = 'e' and coalesce(se.section_e_complete, false) = false)
    )
  order by r.created_at asc;
$$;

grant execute on function public.get_my_passport_completion_requests() to authenticated;

-- get_institution_passport_completions_outstanding() -- the principal's
-- dashboard bucket. Same branching.
drop function if exists public.get_institution_passport_completions_outstanding(uuid);

create function public.get_institution_passport_completions_outstanding(
  p_institution_id uuid
)
returns table (
  id uuid,
  passport_id uuid,
  child_name text,
  recipient_name text,
  target_section text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.passport_id,
    p.child_name,
    coalesce(ru.raw_user_meta_data ->> 'full_name', ru.raw_app_meta_data ->> 'full_name') as recipient_name,
    r.target_section,
    r.created_at
  from public.passport_completion_requests r
  join public.passports p on p.id = r.passport_id
  join auth.users ru on ru.id = r.recipient_id
  left join public.passport_section_e se on se.passport_id = r.passport_id
  where r.institution_id = p_institution_id
    and (
      (r.target_section = 'a' and coalesce(p.section_a_complete, false) = false)
      or (r.target_section = 'e' and coalesce(se.section_e_complete, false) = false)
    )
    and public.institution_staff_has_current_standing(auth.uid(), p_institution_id)
  order by r.created_at asc;
$$;

grant execute on function public.get_institution_passport_completions_outstanding(uuid) to authenticated;

-- get_passport_completion_requests() -- the staff-facing "who was
-- asked" list for one passport. No completion-status filtering here
-- (never had any), just needs target_section added to the shape so the
-- client can show which request is which.
drop function if exists public.get_passport_completion_requests(uuid);

create function public.get_passport_completion_requests(p_passport_id uuid)
returns table (
  id uuid,
  recipient_id uuid,
  recipient_name text,
  target_section text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.recipient_id,
    coalesce(ru.raw_user_meta_data ->> 'full_name', ru.raw_app_meta_data ->> 'full_name') as recipient_name,
    r.target_section,
    r.created_at
  from public.passport_completion_requests r
  join auth.users ru on ru.id = r.recipient_id
  where r.passport_id = p_passport_id
    and (
      public.owns_passport(p_passport_id)
      or public.has_child_access(auth.uid(), p_passport_id)
    )
  order by r.created_at asc;
$$;

grant execute on function public.get_passport_completion_requests(uuid) to authenticated;
