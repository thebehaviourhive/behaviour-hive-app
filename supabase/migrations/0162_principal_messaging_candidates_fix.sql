-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- REAL BUG IN 0161, found live-verifying it, not in review. Migration
-- 0161 added a principal branch to get_message_recipient_candidates()'s
-- `candidates` UNION -- correct for making a principal APPEAR as a
-- candidate to someone else. But the whole `candidates` CTE is gated
-- behind a SEPARATE `authorized` CTE ("select 1 where <caller has an
-- existing relationship to this child>"), and 0161 never added
-- principal to THAT gate. The result: a principal composing a NEW
-- message calls this same function to populate their own recipient
-- picker, and got ZERO candidates back -- not just no principal
-- option, no parent, no class_teacher, no clinician either, because
-- `authorized` was empty for them and every UNION branch is `from
-- authorized, ...`. send_message() itself was fine (its own sender-
-- role determination doesn't route through this CTE) -- confirmed by
-- testing a teacher sending to a parent, which worked -- but the
-- principal's own compose flow was silently broken end to end: no
-- error, just an empty picker.
--
-- Caught by testing the actual principal-composes-to-a-parent path
-- live against production, not assumed working because the SQL
-- compiled and the adversarial suite (which never exercised THIS
-- specific direction) passed. THE FIX: add the same principal
-- condition to `authorized` that 0161 already used for the new
-- `candidates` branch -- an active principal at this child's own
-- institution counts as authorized to query candidates here, same as
-- parent/class_teacher/clinician already do.
--
-- CREATE OR REPLACE is sufficient -- same signature, same return
-- shape, only the `authorized` CTE's own where-clause gains one more
-- branch.

create or replace function public.get_message_recipient_candidates(p_passport_id uuid)
returns table (
  recipient_id uuid,
  full_name text,
  role text
)
language sql
security definer
set search_path = public
stable
as $$
  with authorized as (
    select 1
    where
      public.owns_passport(p_passport_id)
      or exists (
        select 1 from public.passport_access pa
        join public.passport_institution_links pil
          on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
        where pa.passport_id = p_passport_id
          and pa.teacher_id = auth.uid()
          and pa.is_active = true
          and pa.actor_role = 'class_teacher'
      )
      or exists (
        select 1
        from public.class_children cc
        join public.classes c on c.id = cc.class_id
        join public.class_teachers ct on ct.class_id = c.id
        join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
        join public.passport_institution_links pil
          on pil.passport_id = cc.passport_id and pil.institution_id = c.institution_id
        where cc.passport_id = p_passport_id
          and cc.ended_at is null
          and ct.user_id = auth.uid()
          and ct.ended_at is null
          and s.deactivated_at is null
          and s.approved_at is not null
      )
      or (
        public.is_verified_clinician(auth.uid())
        and exists (
          select 1 from public.clinician_access ca
          where ca.passport_id = p_passport_id
            and ca.clinician_id = auth.uid()
            and ca.is_active = true
        )
      )
      or (
        -- NEW -- the missing piece. An active principal at this
        -- child's own institution is authorized to query candidates
        -- here, matching send_message()'s own principal sender branch
        -- exactly (same condition, same institution boundary).
        exists (
          select 1 from public.passport_institution_links pil
          join public.institution_staff s on s.institution_id = pil.institution_id
          where pil.passport_id = p_passport_id
            and s.user_id = auth.uid()
            and s.role = 'principal'
            and s.deactivated_at is null
            and s.approved_at is not null
        )
      )
  ),
  candidates as (
    select g.user_id as recipient_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
           'parent'::text as role
    from authorized, public.passport_guardians g
    join auth.users u on u.id = g.user_id
    where g.passport_id = p_passport_id

    union all

    select pa.teacher_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'class_teacher'
    from authorized, public.passport_access pa
    join public.passport_institution_links pil
      on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
    join auth.users u on u.id = pa.teacher_id
    where pa.passport_id = p_passport_id
      and pa.is_active = true
      and pa.actor_role = 'class_teacher'

    union all

    select ct.user_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'class_teacher'
    from authorized, public.class_children cc
    join public.classes c on c.id = cc.class_id
    join public.class_teachers ct on ct.class_id = c.id
    join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
    join public.passport_institution_links pil
      on pil.passport_id = cc.passport_id and pil.institution_id = c.institution_id
    join auth.users u on u.id = ct.user_id
    where cc.passport_id = p_passport_id
      and cc.ended_at is null
      and ct.ended_at is null
      and s.deactivated_at is null
      and s.approved_at is not null
      and not exists (
        select 1 from public.passport_access pa2
        where pa2.passport_id = p_passport_id
          and pa2.teacher_id = ct.user_id
          and pa2.is_active = true
          and pa2.actor_role = 'class_teacher'
      )

    union all

    select ca.clinician_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'clinician'
    from authorized, public.clinician_access ca
    join auth.users u on u.id = ca.clinician_id
    where ca.passport_id = p_passport_id
      and ca.is_active = true
      and public.is_verified_clinician(ca.clinician_id)

    union all

    -- The active principal at this child's own institution -- 0161's
    -- own addition, unchanged here.
    select s.user_id,
           coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name'),
           'principal'
    from authorized, public.passport_institution_links pil
    join public.institution_staff s on s.institution_id = pil.institution_id
    join auth.users u on u.id = s.user_id
    where pil.passport_id = p_passport_id
      and s.role = 'principal'
      and s.deactivated_at is null
      and s.approved_at is not null
  )
  select recipient_id, full_name, role
  from candidates
  where recipient_id <> auth.uid();
$$;

grant execute on function public.get_message_recipient_candidates(uuid) to authenticated;
