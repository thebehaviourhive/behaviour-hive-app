/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   QABF/MAS respondent-flow refinements -- Change 3's schema piece: a
   per-send, editable instruction line. Two additive columns, no
   existing data touched:

   1. fba_instruments.default_instruction (text, nullable) -- the
      editable-as-data default template, per instrument (matches the
      brief's "stored as instrument data" and the same shape as the FAI
      update's `attribution` column: generic, not QABF/MAS-specific in
      the schema itself, even though only these two get a value today).
      Populated on the currently-active QABF and MAS rows with the
      brief's exact default wording, containing the LITERAL token text
      "[child name]" -- this is never substituted server-side; every
      renderer (respondent screen, clinician results, reader/PDF)
      resolves it independently at render time using the viewer's own
      name-display rule (parents/clinicians get the full name, teachers
      the shortened one, via the existing getChildDisplayName helper),
      which is exactly why the raw token has to survive all the way to
      the client rather than being resolved once at send time.

   2. fba_instrument_requests.instruction (text, nullable) -- the final,
      possibly-edited text for THIS send specifically (different sends
      of the same instrument can focus on different behaviours, per the
      brief). Nullable so the one pre-existing completed test response
      (and any future request created before a clinician touches this
      field, though the send flow always supplies SOMETHING) simply
      renders no instruction block rather than breaking.

   Both existing questionnaire-request RPCs are re-created to add
   `instruction` to their return shape -- a new physical column doesn't
   automatically appear in a function's explicit `returns table (...)`
   list, so this is required, not optional, for the client to ever see
   the stored text. Postgres refuses a plain `create or replace` when
   the return row shape itself changes ("cannot change return type of
   existing function" / "Row type defined by OUT parameters is
   different"), so each is explicitly dropped first, then recreated --
   there's no window where the function doesn't exist, since drop and
   create run back to back in the same statement batch, and every other
   column/clause in both functions is byte-for-byte identical to
   migration 0041 -- confirmed by diffing before writing this. */

alter table public.fba_instruments
  add column if not exists default_instruction text;

alter table public.fba_instrument_requests
  add column if not exists instruction text;

update public.fba_instruments
  set default_instruction = 'When completing the questionnaire, think specifically about times [child name] is displaying aggressive behaviours.'
  where instrument_type in ('qabf', 'mas') and is_active = true;

drop function if exists public.get_fba_instrument_requests(uuid);

create function public.get_fba_instrument_requests(p_fba_id uuid)
returns table (
  id uuid,
  instrument_type text,
  recipient_id uuid,
  recipient_name text,
  recipient_role text,
  status text,
  responses_data jsonb,
  instruction text,
  created_at timestamptz,
  completed_at timestamptz,
  last_reminded_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.instrument_type,
    r.recipient_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as recipient_name,
    case when p.user_id = r.recipient_id then 'parent' else 'class_teacher' end as recipient_role,
    r.status,
    r.responses_data,
    r.instruction,
    r.created_at,
    r.completed_at,
    r.last_reminded_at
  from public.fba_instrument_requests r
  join public.fba_reports fr on fr.id = r.fba_id
  join public.clinician_access ca on ca.passport_id = fr.passport_id
  join public.passports p on p.id = fr.passport_id
  join auth.users u on u.id = r.recipient_id
  where r.fba_id = p_fba_id
    and fr.clinician_id = auth.uid()
    and ca.clinician_id = auth.uid()
    and ca.is_active = true
    and public.is_verified_clinician(auth.uid())
  order by r.created_at desc;
$$;

grant execute on function public.get_fba_instrument_requests(uuid) to authenticated;

drop function if exists public.get_my_instrument_requests();

create function public.get_my_instrument_requests()
returns table (
  id uuid,
  fba_id uuid,
  instrument_type text,
  status text,
  child_name text,
  clinician_name text,
  instruction text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.fba_id,
    r.instrument_type,
    r.status,
    p.child_name,
    coalesce(cu.raw_user_meta_data ->> 'full_name', cu.raw_app_meta_data ->> 'full_name') as clinician_name,
    r.instruction,
    r.created_at
  from public.fba_instrument_requests r
  join public.fba_reports fr on fr.id = r.fba_id
  join public.passports p on p.id = r.passport_id
  join auth.users cu on cu.id = fr.clinician_id
  where r.recipient_id = auth.uid()
    and r.status in ('sent', 'in_progress')
  order by r.created_at asc;
$$;

grant execute on function public.get_my_instrument_requests() to authenticated;
