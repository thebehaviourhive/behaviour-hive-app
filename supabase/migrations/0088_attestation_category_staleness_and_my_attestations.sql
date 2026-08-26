/* Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.

   SCHOOL INCIDENT LOG -- Phase 4, piece 2 (SQL): naming what changed
   when an attestation goes stale, and a way for a named staff member to
   find every incident they're named on, from wherever they actually
   land after login (not just by opening a record they'd have no reason
   to navigate to).

   =====================================================================
   1. PER-CATEGORY STALENESS -- "WHICH PARTS MOVED", NOT A DIFF
   =====================================================================
   compute_incident_content_hash() (0070/0072/0076) hashes ONE combined
   object across six top-level keys: narrative, children (distress_level
   + remained_on_site per child), actions, restrictive_practices,
   injuries, body_marks. get_attestation_status() compares that single
   hash to decide current/stale -- correct for a yes/no answer, but it
   cannot say WHICH of those six changed, because a combined hash is one
   number: any one part moving looks identical to all six moving.

   compute_incident_category_hashes() computes the SAME six categories
   as separate md5s instead of one. incident_attestations gains
   category_hashes (jsonb), populated by attest_to_incident() alongside
   the existing content_hash -- the single combined hash is completely
   untouched (same function, same inputs, same output, byte for byte),
   so no existing attestation's current/stale status changes as a
   result of this migration. category_hashes is purely additive.

   get_stale_categories() compares the CURRENT six hashes against the
   ones stored on the incident_staff row's latest 'attested' event, and
   returns the keys that differ. Same visibility posture as
   get_attestation_status() (security definer, re-checks
   can_view_incident() itself since it bypasses RLS).

   HONEST LIMITATION, not glossed over: an attestation made before this
   migration has no category_hashes at all (null) -- there is no way to
   retroactively know which of the six categories moved for a fact this
   schema never captured before now. get_stale_categories() returns
   null for those rather than guessing, and the UI falls back to a
   generic "something changed" for that one case. Every attestation
   made from this migration forward gets the full breakdown.

   =====================================================================
   2. get_my_incident_attestations() -- ONE PLACE TO LOOK
   =====================================================================
   Every incident the caller is named on via a real account
   (incident_staff.user_id = auth.uid()), NOT restricted to pre-signoff
   -- agreed in chat: a staff member's name is on a legal record and
   they should be able to look up what they attested to even after it's
   closed, not lose access the moment it locks. is_closed marks that
   state; the client is what excludes closed rows from any prompt or
   count, not this function refusing to return them.

   status/status_label reuse get_attestation_status() (0070) verbatim --
   no new definition of what counts as current/stale/withdrawn/
   not_attested. stale_categories is populated (via get_stale_categories()
   above) only when status = 'stale', so the list view can show what
   changed without a second round trip per incident.

   Plain function, not security definer -- the caller already has RLS-
   granted visibility into every incident they're validly named on
   (can_view_incident()'s own "named staff, once past draft" branch), so
   there's nothing here that needs elevated privilege to read correctly;
   the query is naturally scoped to exactly what auth.uid() can already
   see, no separate check to get right or wrong.

   Ordering the outstanding-vs-done distinction is left to the client
   (status + is_closed together already carry it): not_attested and
   stale are outstanding; withdrawn is a completed decision, shown as
   done, never counted as pending -- agreed in chat, a badge that keeps
   nagging someone who withdrew would push them back toward re-attesting
   just to silence it, which corrupts exactly the signal withdrawal
   exists to carry. */


-- =====================================================================
-- 1. category_hashes -- additive column, no constraint change needed.
-- (No direct-insert policy exists on this table at all -- every write
-- goes through attest_to_incident()/withdraw_attestation(), so there's
-- no path for a client to insert a mismatched category_hashes/action
-- combination the way the existing content_hash/withdrawal_reason CHECK
-- has to guard against.)
-- =====================================================================

alter table public.incident_attestations add column category_hashes jsonb;


-- =====================================================================
-- 2. compute_incident_category_hashes() -- same six categories as
-- compute_incident_content_hash(), each hashed separately. Internal
-- only, matching that function's own "no grant to authenticated"
-- posture -- the client only ever reaches this indirectly, through
-- get_stale_categories() below.
-- =====================================================================

create or replace function public.compute_incident_category_hashes(p_incident_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'narrative', md5(coalesce((select i.narrative from public.incidents i where i.id = p_incident_id), '')),
    'children', md5(coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'child_index', ic.child_index,
          'distress_level', ic.distress_level,
          'remained_on_site', ic.remained_on_site
        ) order by ic.child_index
      )::text
      from public.incident_children ic
      where ic.incident_id = p_incident_id
    ), '[]')),
    'actions', md5(coalesce((
      select jsonb_agg(ia.action_type_id order by ia.action_type_id)::text
      from public.incident_actions ia
      where ia.incident_id = p_incident_id
    ), '[]')),
    'restrictive_practices', md5(coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'passport_id', rp.passport_id,
          'planning_status', rp.planning_status,
          'reason_codes', rp.reason_codes,
          'disengagement_codes', rp.disengagement_codes,
          'hold_type', rp.hold_type,
          'hold_position', rp.hold_position,
          'hold_level', rp.hold_level,
          'result_codes', rp.result_codes,
          'total_procedures', rp.total_procedures,
          'staff_initials', rp.staff_initials
        ) order by rp.id
      )::text
      from public.restrictive_practices rp
      where rp.incident_id = p_incident_id
    ), '[]')),
    'injuries', md5(coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'injured_party_type', inj.injured_party_type,
          'passport_id', inj.passport_id,
          'staff_user_id', inj.staff_user_id,
          'free_text_name', inj.free_text_name,
          'injury_types', inj.injury_types,
          'injury_notes', inj.injury_notes,
          'first_aider_called', inj.first_aider_called,
          'first_aider_name', inj.first_aider_name,
          'doctor_ambulance_called', inj.doctor_ambulance_called,
          'treatments', inj.treatments,
          'treatment_other', inj.treatment_other,
          'remained_on_site', inj.remained_on_site,
          'remained_detail', inj.remained_detail
        ) order by inj.id
      )::text
      from public.incident_injuries inj
      where inj.incident_id = p_incident_id
    ), '[]')),
    'body_marks', md5(coalesce((
      select jsonb_agg(
        jsonb_build_object('view', bm.view, 'x', bm.x, 'y', bm.y, 'injury_type_id', bm.injury_type_id)
        order by bm.id
      )::text
      from public.incident_body_marks bm
      join public.incident_injuries bmi on bmi.id = bm.injury_id
      where bmi.incident_id = p_incident_id
    ), '[]'))
  );
$$;

-- No grant to authenticated -- internal only, same posture as
-- compute_incident_content_hash().


-- =====================================================================
-- 3. attest_to_incident() -- confirmed against the live definition
-- before writing this. ONE change: category_hashes added to the
-- insert. Everything else -- signature, the named-staff-member-only
-- check, the pre-signoff-only check, the exception text -- copied
-- verbatim.
-- =====================================================================

create or replace function public.attest_to_incident(p_incident_staff_id uuid, p_addendum text default null::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_incident_id uuid;
  v_attestation_id uuid;
begin
  select st.incident_id
  into v_incident_id
  from public.incident_staff st
  join public.incidents i on i.id = st.incident_id
  where st.id = p_incident_staff_id
    and st.user_id = auth.uid()
    and i.teacher_signed_at is null;

  if v_incident_id is null then
    raise exception 'You cannot attest to this incident -- you may not be the named staff member, or it may already be signed off.';
  end if;

  insert into public.incident_attestations (incident_id, incident_staff_id, action, content_hash, category_hashes, addendum, created_by)
  values (
    v_incident_id,
    p_incident_staff_id,
    'attested',
    public.compute_incident_content_hash(v_incident_id),
    public.compute_incident_category_hashes(v_incident_id),
    p_addendum,
    auth.uid()
  )
  returning id into v_attestation_id;

  return v_attestation_id;
end;
$function$;


-- =====================================================================
-- 4. get_stale_categories() -- which of the six categories changed
-- since the named staff member's latest attestation. Null (not an
-- empty array) whenever there's nothing to report: no standing to view
-- the incident, no attestation on record, latest event isn't an
-- attestation (withdrawn has nothing to compare), or the attestation
-- predates this migration and has no category_hashes to compare
-- against. The caller is expected to only render this when
-- get_attestation_status() already says 'stale'.
-- =====================================================================

create or replace function public.get_stale_categories(p_incident_staff_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_incident_id uuid;
  v_latest_action text;
  v_latest_category_hashes jsonb;
  v_current_category_hashes jsonb;
  v_stale text[] := array[]::text[];
  v_key text;
begin
  select st.incident_id into v_incident_id
  from public.incident_staff st
  where st.id = p_incident_staff_id;

  if v_incident_id is null or not public.can_view_incident(v_incident_id) then
    return null;
  end if;

  select action, category_hashes
  into v_latest_action, v_latest_category_hashes
  from public.incident_attestations
  where incident_staff_id = p_incident_staff_id
  order by created_at desc
  limit 1;

  if v_latest_action is distinct from 'attested' then
    return null;
  end if;

  if v_latest_category_hashes is null then
    return null;
  end if;

  v_current_category_hashes := public.compute_incident_category_hashes(v_incident_id);

  for v_key in select jsonb_object_keys(v_current_category_hashes) loop
    if v_current_category_hashes ->> v_key is distinct from v_latest_category_hashes ->> v_key then
      v_stale := array_append(v_stale, v_key);
    end if;
  end loop;

  return v_stale;
end;
$$;

grant execute on function public.get_stale_categories(uuid) to authenticated;


-- =====================================================================
-- 5. get_my_incident_attestations() -- the dashboard entry point's data
-- source. Every incident the caller is named on with a real account,
-- every status, not restricted to pre-signoff.
-- =====================================================================

create or replace function public.get_my_incident_attestations()
returns table (
  incident_id uuid,
  incident_staff_id uuid,
  occurred_at timestamptz,
  location text,
  status text,
  status_label text,
  stale_categories text[],
  is_closed boolean
)
language plpgsql
stable
as $$
begin
  return query
  select
    i.id as incident_id,
    st.id as incident_staff_id,
    i.occurred_at,
    loc.value as location,
    public.get_attestation_status(st.id) as status,
    case public.get_attestation_status(st.id)
      when 'current' then 'Current'
      when 'stale' then 'Stale'
      when 'withdrawn' then 'Withdrawn'
      when 'not_attested' then 'Not attested'
      else initcap(replace(public.get_attestation_status(st.id), '_', ' '))
    end as status_label,
    case
      when public.get_attestation_status(st.id) = 'stale' then public.get_stale_categories(st.id)
      else null
    end as stale_categories,
    i.teacher_signed_at is not null as is_closed
  from public.incident_staff st
  join public.incidents i on i.id = st.incident_id
  join public.incident_locations loc on loc.id = i.location_id
  where st.user_id = auth.uid()
  order by i.occurred_at desc;
end;
$$;

grant execute on function public.get_my_incident_attestations() to authenticated;
