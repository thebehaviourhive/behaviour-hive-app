-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- PRD 2, Stage 5 follow-up -- two corrections found answering Daniel's
-- own three review questions on 0129, before any client code:
--
-- 1. get_sna_roommates() (0129) returned child_name only. Checked
--    against PRD 1's own definition of roster tier -- BSP, triggers,
--    calming approaches, communication and medical needs -- and that
--    was an ACCIDENTAL narrowing, not a deliberate one. It was written
--    from "roster-level ONLY" read in isolation, contrasted against
--    get_temporary_access_covered_children()'s own full-access shape,
--    without checking what roster tier actually contains. Corrected
--    below to the same field bundle src/app/sna/passport/[passportId]/
--    page.tsx already uses for a full-access SNA's own read of a
--    child (minus morning-checkin operational fields, which aren't
--    support information) -- diagnoses (medical needs), hard_signals/
--    hard_triggers (triggers), before/during/after_behaviour (calming
--    approaches / the closest thing this schema has to a BSP),
--    communication_methods/shows_happy/shows_anxious/phrases_to_avoid
--    (communication needs). DROP + CREATE, column list changes.
--
-- 2. "What can a class SNA reach versus a class teacher, at query
--    level?" -- traced has_class_teacher_access()'s own call sites
--    fully rather than assuming. It gates: strategy_ledger (read +
--    insert), teacher_updates, abc_logs, strategy_feedback,
--    strategy_feedback_prompts, can_view_message, and activity_log's
--    own RLS (0110 already collapsed that policy to call this helper
--    directly -- read the LIVE definition, not 0028's original, which
--    duplicated the logic inline before 0110 replaced it). Widening
--    the helper itself, once, correctly cascades "full class-tier
--    access" to every one of those sites automatically -- the entire
--    point of it being a chokepoint. Mirrors has_sna_access()'s own
--    fourth branch (0129) in shape. Signature unchanged -- CREATE OR
--    REPLACE.
--
--    get_teacher_activity_feed() does NOT call the helper -- it
--    duplicates has_class_teacher_access()'s own two branches inline
--    (checked directly, not assumed from the RLS policy's own
--    delegation). Widened here with the matching third branch,
--    reproducing its own existing class_teachers branch's shape
--    exactly, institution-match join included.
--
--    NOT WIDENED HERE, DELIBERATELY, PENDING A SEPARATE DECISION:
--    get_message_recipient_candidates() and send_message(). Messages
--    has been class_teacher-only "by Stage 2's own design" since it
--    was built (0105's own comment, naming both as two of the four
--    "preserved-stricter" sites) -- no SNA role, temporary or
--    permanent, has ever had messaging capability in this product.
--    Extending it isn't a query-shape widen the way the other four
--    sites are: send_message()'s own v_sender_role gate is checked
--    against message_categories.allowed_sender_roles, which has no
--    'sna' value in any row today -- a class SNA branch here would
--    authenticate correctly and then hit "This category is not
--    available to your role" on every category, doing nothing, unless
--    that table is also decided and edited. That's a real product
--    decision (which categories, if any, a class SNA should be able
--    to send), not a mechanical extension of the chokepoint pattern --
--    named here rather than silently decided or silently skipped.

-- =====================================================================
-- 1. get_sna_roommates() -- corrected to the real roster-tier fields.
-- =====================================================================
drop function if exists public.get_sna_roommates(uuid);

create function public.get_sna_roommates(p_passport_id uuid)
returns table (
  passport_id uuid,
  child_name text,
  diagnoses text[],
  diagnosis_other text,
  hard_signals text[],
  hard_signals_other text,
  hard_triggers text[],
  hard_triggers_other text,
  before_behaviour text[],
  before_behaviour_other text,
  during_distress text[],
  during_distress_other text,
  after_distress text[],
  after_distress_other text,
  communication_methods text[],
  communication_methods_other text,
  shows_happy text,
  shows_anxious text,
  phrases_to_avoid text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p2.id as passport_id,
    p2.child_name,
    p2.diagnoses,
    p2.diagnosis_other,
    sb.hard_signals,
    sb.hard_signals_other,
    sb.hard_triggers,
    sb.hard_triggers_other,
    sd.before_behaviour,
    sd.before_behaviour_other,
    sd.during_distress,
    sd.during_distress_other,
    sd.after_distress,
    sd.after_distress_other,
    sc.communication_methods,
    sc.communication_methods_other,
    sc.shows_happy,
    sc.shows_anxious,
    sc.phrases_to_avoid
  from public.child_assignments ca
  join public.institution_staff s on s.user_id = ca.user_id and s.institution_id = ca.institution_id
  join public.class_children cc_mine on cc_mine.passport_id = ca.passport_id and cc_mine.ended_at is null
  join public.class_children cc_other on cc_other.class_id = cc_mine.class_id and cc_other.ended_at is null
  join public.passports p2 on p2.id = cc_other.passport_id
  left join public.passport_section_b sb on sb.passport_id = p2.id
  left join public.passport_section_c sc on sc.passport_id = p2.id
  left join public.passport_section_d sd on sd.passport_id = p2.id
  where ca.passport_id = p_passport_id
    and ca.user_id = auth.uid()
    and ca.ended_at is null
    and s.deactivated_at is null
    and s.approved_at is not null
    and cc_other.passport_id <> p_passport_id;
$$;

grant execute on function public.get_sna_roommates(uuid) to authenticated;

-- =====================================================================
-- 2. has_class_teacher_access() -- fourth branch, mirrors
--    has_sna_access()'s own class_sna_assignments branch (0129).
--    Signature unchanged -- CREATE OR REPLACE.
-- =====================================================================
create or replace function public.has_class_teacher_access(
  p_user_id uuid,
  p_passport_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (
      select 1 from public.passport_access pa
      where pa.passport_id = p_passport_id
        and pa.teacher_id = p_user_id
        and pa.is_active = true
        and pa.actor_role = 'class_teacher'
    )
    or exists (
      select 1
      from public.class_children cc
      join public.classes c on c.id = cc.class_id
      join public.class_teachers ct on ct.class_id = c.id
      join public.institution_staff s on s.user_id = ct.user_id and s.institution_id = c.institution_id
      where cc.passport_id = p_passport_id
        and cc.ended_at is null
        and ct.user_id = p_user_id
        and ct.ended_at is null
        and s.deactivated_at is null
        and s.approved_at is not null
    )
    or exists (
      select 1
      from public.class_children cc
      join public.classes c on c.id = cc.class_id
      join public.class_sna_assignments csa on csa.class_id = c.id
      join public.institution_staff s on s.user_id = csa.user_id and s.institution_id = c.institution_id
      where cc.passport_id = p_passport_id
        and cc.ended_at is null
        and csa.user_id = p_user_id
        and csa.ended_at is null
        and s.deactivated_at is null
        and s.approved_at is not null
    );
$$;

grant execute on function public.has_class_teacher_access(uuid, uuid) to authenticated;

-- =====================================================================
-- 3. get_teacher_activity_feed() -- third branch added, matching the
--    existing class_teachers branch's own shape exactly (institution-
--    match join included). Everything else reproduced verbatim from
--    the live 0110 body.
-- =====================================================================
create or replace function public.get_teacher_activity_feed(
  p_limit integer default 20, p_offset integer default 0
)
returns table (
  id uuid, passport_id uuid, child_name text, event_type text,
  event_description text, created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select al.id, al.passport_id, p.child_name, al.event_type, al.event_description, al.created_at
  from public.activity_log al
  join public.passports p on p.id = al.passport_id
  where (
      exists (
        select 1 from public.passport_access pa
        join public.passport_institution_links pil
          on pil.passport_id = pa.passport_id and pil.institution_id = pa.institution_id
        where pa.passport_id = al.passport_id
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
        where cc.passport_id = al.passport_id
          and cc.ended_at is null
          and ct.user_id = auth.uid()
          and ct.ended_at is null
          and s.deactivated_at is null
          and s.approved_at is not null
      )
      or exists (
        select 1
        from public.class_children cc
        join public.classes c on c.id = cc.class_id
        join public.class_sna_assignments csa on csa.class_id = c.id
        join public.institution_staff s on s.user_id = csa.user_id and s.institution_id = c.institution_id
        join public.passport_institution_links pil
          on pil.passport_id = cc.passport_id and pil.institution_id = c.institution_id
        where cc.passport_id = al.passport_id
          and cc.ended_at is null
          and csa.user_id = auth.uid()
          and csa.ended_at is null
          and s.deactivated_at is null
          and s.approved_at is not null
      )
    )
    and al.event_type in (
      'passport_updated', 'abc_logged', 'team_linked', 'strategy_logged',
      'access_revoked', 'afternoon_update', 'clinical_content_added'
    )
    and (al.event_type <> 'abc_logged' or al.actor_id = auth.uid())
    and not exists (
      select 1 from public.clinicians c where c.user_id = al.actor_id
    )
  order by al.created_at desc
  limit p_limit offset p_offset;
$$;

grant execute on function public.get_teacher_activity_feed(integer, integer) to authenticated;
