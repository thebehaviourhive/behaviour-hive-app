-- Run this in the Supabase Dashboard: SQL Editor -> New query -> paste -> Run.
--
-- CLIENT INFO -- a new clinic-only section, entered as part of adding a
-- client, editable afterward from the client's own record. Recon done
-- first (reported separately); this migration is the build against
-- Daniel's six decisions.
--
-- TWO TABLES, NOT ONE, AND NOT A COLUMN-LEVEL SPLIT ON ONE TABLE. This
-- schema already has a documented, hard-learned reason a single table
-- can't cleanly separate "admin may touch this" from "admin may never
-- touch this" via Postgres column GRANTs: every caller here shares the
-- `authenticated` database role, so a column grant can't be conditioned
-- on which RLS policy admitted the row (the exact trap the PRD 7
-- assessment-response-sheet build hit). Two tables means two ordinary
-- policies -- client_clinical_intake simply has no admin-admitting
-- policy anywhere, in either direction, the same structural-absence
-- shape clinical_plans already proves for clinic_admin/clinical_lead.
--
-- FOUR HELPERS, READ SPLIT FROM WRITE, DELIBERATELY. "Who may ENTER
-- clinical intake" (director or practitioner, per Daniel's own
-- decision) is a WRITE question, gated by institutions.
-- practitioner_can_onboard -- the same toggle onboard_clinic_client()
-- already uses, so the toggle keeps one coherent meaning ("does this
-- clinic let practitioners take on onboarding-level authority") rather
-- than acquiring a second, different meaning for a different action. A
-- practitioner already engaged on a case still needs to READ what's
-- there regardless of that toggle -- so read is role-gated, not
-- toggle-gated, for the two roles decided to ever see clinical content
-- at all (principal, clinician). clinic_admin never appears in either
-- clinical helper, in any direction.
--
-- THE ONE THAT MATTERS MOST: suspected_diagnosis lives on
-- client_clinical_intake and nothing else ever references it. No
-- trigger, no RPC, no sync writes from this table to `passports` at
-- any point -- the same structural-absence guarantee finalize_fba_
-- report() already relies on for its own clinical content (it only
-- ever writes passport_clinical_content, never a passports column).
-- Named distinctly from passports.diagnoses on purpose, so a future
-- `update passports set diagnoses = ...` referencing it would look
-- wrong on sight, not just be wrong in fact.
--
-- CROSS-ORGANISATION GRANTS: untouched, deliberately. cross_organisation
-- _grants.scope_items is a positive allow-list (`<@ array['fba_report',
-- 'bsp']`) with exactly 3 call sites of has_cross_org_grant_access() in
-- the whole schema, none of them here. Nothing in this migration adds a
-- 4th. That absence IS the guarantee a school can never reach this
-- through a grant -- the same shape session_notes/assessments already
-- use to never cross, by never being named.
--
-- PLAN A, BUILT SO PLAN B IS ONE POLICY AWAY. Daniel's own reasoning: a
-- parent could read "suspected diagnosis" before a clinician has
-- discussed it with them. client_clinical_intake gets no parent-facing
-- SELECT policy at all. Enabling parent visibility later is exactly one
-- `create policy ... using (owns_passport(passport_id))` statement on
-- this same table -- nothing else about its shape needs to change.

-- =====================================================================
-- 1. TABLES
-- =====================================================================

create table public.client_contact_info (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  institution_id uuid not null references public.institutions (id),

  guardian_full_name text,
  relationship_to_child text,
  contact_email text,
  contact_phone text,
  -- "How they heard about the clinic" (the form's own field).
  referral_source text,
  home_address text,

  entered_by uuid not null references auth.users (id),

  -- A SHARED fact about the family record, not per-guardian (Daniel's
  -- decision 3) -- one pair of columns on the row, set only by
  -- confirm_client_contact_info() below, never by a raw client write
  -- (enforced by the trigger, not merely by convention). Reset to null
  -- the moment any of the six fields above genuinely changes, by
  -- either a parent's own edit or a later staff correction -- an
  -- outdated "confirmed" stamp sitting on changed content would
  -- mislead a director reading it, the exact failure this column
  -- exists to prevent.
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (passport_id, institution_id)
);

comment on table public.client_contact_info is
  'Clinic-only. Entered by clinic staff at onboarding (or later), confirmed/editable by the claiming parent. Never visible to a school under any path.';

create table public.client_clinical_intake (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  institution_id uuid not null references public.institutions (id),

  -- NEVER referenced by any write to passports.diagnoses, anywhere,
  -- ever -- see this migration's own header. A suspected diagnosis is
  -- not a formal one; passports.diagnoses is shared with schools, and
  -- an unconfirmed label reaching a school would mislabel a child with
  -- something no clinician has yet established. Named distinctly from
  -- that column on purpose.
  suspected_diagnosis text,
  main_concerns text,
  previous_support boolean,
  previous_support_description text,
  -- "What they want from working with the clinic."
  clinic_goals text,
  -- "Anything else they want the clinic to know."
  additional_notes text,

  entered_by uuid not null references auth.users (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (passport_id, institution_id)
);

comment on table public.client_clinical_intake is
  'Clinic-only, clinical staff only (never clinic_admin, in either direction). No parent-facing policy exists on this table -- Plan A, per Daniel''s own decision. Enabling parent visibility later needs exactly one additional SELECT policy here, nothing else.';

-- =====================================================================
-- 2. HELPERS -- read split from write, clinic-type baked in directly,
-- not left to convention (the exact gap section 6 below closes on
-- strategy_bank/session_types).
-- =====================================================================

create function public._client_info_readable(p_institution_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
      and s.role in ('principal', 'clinic_admin', 'clinician')
  );
$$;

comment on function public._client_info_readable(uuid) is
  'Contact info read: any current clinic staff (director, admin, or clinician) -- never toggle-gated. Working staff need to see a family''s contact details regardless of whether their clinic has enabled self-service onboarding for practitioners.';

create function public._client_info_contact_writable(p_institution_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
      and (
        s.role in ('principal', 'clinic_admin')
        or (s.role = 'clinician' and inst.practitioner_can_onboard)
      )
  );
$$;

comment on function public._client_info_contact_writable(uuid) is
  'Contact info write: director/admin always, a practitioner only when practitioner_can_onboard is on -- the identical authorization shape onboard_clinic_client() already uses, so the toggle keeps one coherent meaning across both actions.';

create function public._client_info_clinical_readable(p_institution_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
      and s.role in ('principal', 'clinician')
  );
$$;

comment on function public._client_info_clinical_readable(uuid) is
  'Clinical intake read: director or clinician only -- clinic_admin is structurally absent from this check, in either direction, matching Daniel''s own decision that an admin sees no clinical content at all.';

create function public._client_info_clinical_writable(p_institution_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and inst.type = 'clinic'
      and public.institution_staff_has_current_standing(s.user_id, s.institution_id)
      and (
        s.role = 'principal'
        or (s.role = 'clinician' and inst.practitioner_can_onboard)
      )
  );
$$;

comment on function public._client_info_clinical_writable(uuid) is
  'Clinical intake write: director always, a practitioner only when practitioner_can_onboard is on. clinic_admin is never admitted, regardless of the toggle.';

-- =====================================================================
-- 3. RLS
-- =====================================================================

alter table public.client_contact_info enable row level security;

create policy "Clinic staff can view client contact info"
  on public.client_contact_info for select to authenticated
  using (public._client_info_readable(institution_id));

create policy "A parent or guardian can view their own child's contact info"
  on public.client_contact_info for select to authenticated
  using (public.owns_passport(passport_id));

-- Decision 2: the parent's own details, editable, not just
-- acknowledgeable -- Sections A-D are already guardian-editable, and
-- correcting their own information is their right under GDPR. Raw RLS
-- (a single owns_passport() predicate) is the right shape here, same
-- idiom Section A-D already use -- the compound institution-type/role
-- check staff need is what forced the RPC route below, not a general
-- rule against direct table writes.
create policy "A parent or guardian can edit their own child's contact info"
  on public.client_contact_info for update to authenticated
  using (public.owns_passport(passport_id))
  with check (public.owns_passport(passport_id));

-- No staff INSERT/UPDATE policy on this table at all -- writes go
-- through set_client_contact_info() only (section 5), matching bsp's
-- own "no INSERT/UPDATE policy, functions only" posture. The
-- institution-type-plus-role check staff need doesn't map cleanly onto
-- a single RLS predicate the way owns_passport() does for a parent, and
-- duplicating it in both a raw policy and an RPC is how this schema's
-- own "read the live definition" mistakes happen twice.

alter table public.client_clinical_intake enable row level security;

create policy "Clinic staff can view client clinical intake"
  on public.client_clinical_intake for select to authenticated
  using (public._client_info_clinical_readable(institution_id));

-- No parent policy. No staff INSERT/UPDATE policy either -- writes go
-- through set_client_clinical_intake() only, same reasoning as above.

-- =====================================================================
-- 4. TRIGGERS -- attribution stays with whoever first entered it;
-- confirmation is its own deliberate act, never a side effect of a
-- raw update (closing a real spoofing gap: without this, a parent's
-- own RLS-permitted UPDATE could set confirmed_at/confirmed_by
-- directly, impersonating a confirmation that never happened).
-- =====================================================================

create function public._client_contact_info_protect_fields()
returns trigger
language plpgsql
as $$
begin
  new.entered_by := old.entered_by;
  new.passport_id := old.passport_id;
  new.institution_id := old.institution_id;

  if current_setting('client_info.confirming', true) = 'true' then
    -- confirm_client_contact_info() sets this, local to its own single
    -- UPDATE statement, and it is the ONLY path that may ever set
    -- confirmed_at/confirmed_by.
    new.updated_at := now();
    return new;
  end if;

  new.confirmed_at := old.confirmed_at;
  new.confirmed_by := old.confirmed_by;

  if new.guardian_full_name is distinct from old.guardian_full_name
    or new.relationship_to_child is distinct from old.relationship_to_child
    or new.contact_email is distinct from old.contact_email
    or new.contact_phone is distinct from old.contact_phone
    or new.referral_source is distinct from old.referral_source
    or new.home_address is distinct from old.home_address
  then
    new.confirmed_at := null;
    new.confirmed_by := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger client_contact_info_protect_fields
  before update on public.client_contact_info
  for each row execute function public._client_contact_info_protect_fields();

create function public._client_clinical_intake_protect_fields()
returns trigger
language plpgsql
as $$
begin
  new.entered_by := old.entered_by;
  new.passport_id := old.passport_id;
  new.institution_id := old.institution_id;
  new.updated_at := now();
  return new;
end;
$$;

create trigger client_clinical_intake_protect_fields
  before update on public.client_clinical_intake
  for each row execute function public._client_clinical_intake_protect_fields();

-- =====================================================================
-- 5. WRITE RPCs -- decision 1: two follow-up RPCs after
-- onboard_clinic_client(), matching the tag-step precedent (0214) so a
-- failed save costs nothing beyond itself and never risks a duplicate
-- child. Both are genuine upserts, so the SAME RPC is also how "editable
-- afterward from the client's record" is served -- one write path,
-- reused, never a second one for "edit" vs "create".
-- =====================================================================

create function public.set_client_contact_info(
  p_passport_id uuid,
  p_institution_id uuid,
  p_guardian_full_name text,
  p_relationship_to_child text,
  p_contact_email text,
  p_contact_phone text,
  p_referral_source text,
  p_home_address text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public._client_info_contact_writable(p_institution_id) then
    raise exception 'Only a clinical director, admin, or (where enabled) a practitioner can enter this client''s contact details.';
  end if;

  if not exists (
    select 1 from public.passport_institution_links
    where passport_id = p_passport_id and institution_id = p_institution_id
  ) then
    raise exception 'This client is not linked to your clinic.';
  end if;

  insert into public.client_contact_info (
    passport_id, institution_id, guardian_full_name, relationship_to_child,
    contact_email, contact_phone, referral_source, home_address, entered_by
  ) values (
    p_passport_id, p_institution_id,
    nullif(trim(p_guardian_full_name), ''), nullif(trim(p_relationship_to_child), ''),
    nullif(trim(p_contact_email), ''), nullif(trim(p_contact_phone), ''),
    nullif(trim(p_referral_source), ''), nullif(trim(p_home_address), ''),
    auth.uid()
  )
  on conflict (passport_id, institution_id) do update set
    guardian_full_name = excluded.guardian_full_name,
    relationship_to_child = excluded.relationship_to_child,
    contact_email = excluded.contact_email,
    contact_phone = excluded.contact_phone,
    referral_source = excluded.referral_source,
    home_address = excluded.home_address
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.set_client_contact_info(uuid, uuid, text, text, text, text, text, text) to authenticated;

create function public.set_client_clinical_intake(
  p_passport_id uuid,
  p_institution_id uuid,
  p_suspected_diagnosis text,
  p_main_concerns text,
  p_previous_support boolean,
  p_previous_support_description text,
  p_clinic_goals text,
  p_additional_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public._client_info_clinical_writable(p_institution_id) then
    raise exception 'Only a clinical director or practitioner can enter this client''s clinical intake.';
  end if;

  if not exists (
    select 1 from public.passport_institution_links
    where passport_id = p_passport_id and institution_id = p_institution_id
  ) then
    raise exception 'This client is not linked to your clinic.';
  end if;

  insert into public.client_clinical_intake (
    passport_id, institution_id, suspected_diagnosis, main_concerns,
    previous_support, previous_support_description, clinic_goals, additional_notes, entered_by
  ) values (
    p_passport_id, p_institution_id,
    nullif(trim(p_suspected_diagnosis), ''), nullif(trim(p_main_concerns), ''),
    p_previous_support, nullif(trim(p_previous_support_description), ''),
    nullif(trim(p_clinic_goals), ''), nullif(trim(p_additional_notes), ''),
    auth.uid()
  )
  on conflict (passport_id, institution_id) do update set
    suspected_diagnosis = excluded.suspected_diagnosis,
    main_concerns = excluded.main_concerns,
    previous_support = excluded.previous_support,
    previous_support_description = excluded.previous_support_description,
    clinic_goals = excluded.clinic_goals,
    additional_notes = excluded.additional_notes
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.set_client_clinical_intake(uuid, uuid, text, text, boolean, text, text, text) to authenticated;

-- Decision 2 + 3: the parent's own confirmation of the shared family
-- record. Any guardian of this passport may call it (owns_passport());
-- whichever one does, the fact is true for the family, not per-guardian
-- -- a second guardian sees confirmed_at already set and is never asked
-- to reconfirm. set_config(..., true) scopes the bypass to this one
-- transaction only, never leaking to any other statement.
create function public.confirm_client_contact_info(p_passport_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.owns_passport(p_passport_id) then
    raise exception 'Only this child''s own parent or guardian can confirm this.';
  end if;

  perform set_config('client_info.confirming', 'true', true);
  update public.client_contact_info
  set confirmed_at = now(), confirmed_by = auth.uid()
  where passport_id = p_passport_id;
end;
$$;

grant execute on function public.confirm_client_contact_info(uuid) to authenticated;

-- =====================================================================
-- 6. DECISION 5 -- the claim-code RPCs are director-only today, even
-- though clinic_admin can already onboard a client. Widened to admit
-- clinic_admin AT A CLINIC specifically (not blanket -- a school's own
-- principal-only claim flow for a pupil is completely unaffected).
-- Same-signature body-only changes throughout -- CREATE OR REPLACE, no
-- DROP needed.
--
-- get_passport_guardians_for_child() is a fourth function, not named in
-- Daniel's own list of three -- widened anyway, because leaving it out
-- would reproduce the identical bug being fixed here, one RPC smaller:
-- an admin who can generate a code still couldn't see who's already
-- claimed, or reach the "generate a code for a second guardian" branch,
-- for a client they onboarded themselves. Flagged, not silently done.
-- =====================================================================

create or replace function public.generate_passport_claim_code(p_institution_id uuid, p_passport_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child_name text;
  v_prefix text;
  v_code text;
  v_found boolean := false;
  v_attempt int;
begin
  if not exists (
    select 1 from public.institution_staff s
    join public.institutions inst on inst.id = s.institution_id
    where s.institution_id = p_institution_id
      and s.user_id = auth.uid()
      and (s.role = 'principal' or (s.role = 'clinic_admin' and inst.type = 'clinic'))
      and s.deactivated_at is null
      and s.approved_at is not null
      and inst.status = 'verified'
  ) then
    raise exception 'Only an active, verified principal (or, at a clinic, an admin) can generate a claim code.';
  end if;

  select p.child_name into v_child_name
  from public.passports p
  where p.id = p_passport_id
    and exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = p.id and pil.institution_id = p_institution_id
    );

  if v_child_name is null then
    raise exception 'This child has no link to your institution.';
  end if;

  if exists (
    select 1 from public.passport_claim_codes cc
    where cc.passport_id = p_passport_id
      and cc.revoked_at is null
      and cc.claimed_at is null
      and cc.institution_id <> p_institution_id
  ) then
    raise exception 'A claim code for this child was already issued by a different school. Ask them to revoke it first.';
  end if;

  update public.passport_claim_codes
  set revoked_at = now(), revoked_by = auth.uid()
  where passport_id = p_passport_id
    and institution_id = p_institution_id
    and revoked_at is null
    and claimed_at is null;

  v_prefix := upper(left(regexp_replace(coalesce(v_child_name, 'CHD'), '[^a-zA-Z]', '', 'g') || 'XXX', 3));

  for v_attempt in 1..10 loop
    v_code := v_prefix || '-' || lpad(floor(random() * 10000)::int::text, 4, '0');
    if not exists (select 1 from public.passport_claim_codes where code = v_code) then
      v_found := true;
      exit;
    end if;
  end loop;

  if not v_found then
    raise exception 'Could not generate a unique code. Please try again.';
  end if;

  insert into public.passport_claim_codes (passport_id, institution_id, code, created_by, expires_at)
  values (p_passport_id, p_institution_id, v_code, auth.uid(), now() + interval '7 days');

  return v_code;
end;
$$;

create or replace function public.get_passport_claim_code_status(p_institution_id uuid, p_passport_id uuid)
returns table (id uuid, code text, expires_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select cc.id, cc.code, cc.expires_at
  from public.passport_claim_codes cc
  where cc.passport_id = p_passport_id
    and cc.institution_id = p_institution_id
    and cc.revoked_at is null
    and cc.claimed_at is null
    and cc.expires_at > now()
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and (s.role = 'principal' or (s.role = 'clinic_admin' and inst.type = 'clinic'))
        and s.deactivated_at is null
        and s.approved_at is not null
        and inst.status = 'verified'
    );
$$;

create or replace function public.revoke_passport_claim_code(p_claim_code_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_institution_id uuid;
  v_claimed_at timestamptz;
  v_revoked_at timestamptz;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required.';
  end if;

  select cc.institution_id, cc.claimed_at, cc.revoked_at
  into v_institution_id, v_claimed_at, v_revoked_at
  from public.passport_claim_codes cc
  where cc.id = p_claim_code_id;

  if v_institution_id is null then
    raise exception 'Not found.';
  end if;

  if not public.institution_staff_has_current_standing(auth.uid(), v_institution_id)
     or not exists (
       select 1 from public.institution_staff s
       join public.institutions inst on inst.id = s.institution_id
       where s.institution_id = v_institution_id
         and s.user_id = auth.uid()
         and (s.role = 'principal' or (s.role = 'clinic_admin' and inst.type = 'clinic'))
     )
  then
    raise exception 'Only an active, verified principal (or, at a clinic, an admin) at the institution that issued this code can revoke it.';
  end if;

  if v_claimed_at is not null then
    raise exception 'This code has already been claimed and cannot be revoked.';
  end if;

  if v_revoked_at is not null then
    raise exception 'This code has already been revoked.';
  end if;

  update public.passport_claim_codes
  set revoked_at = now(), revoked_by = auth.uid(), revocation_reason = trim(p_reason)
  where id = p_claim_code_id;
end;
$$;

create or replace function public.get_passport_guardians_for_child(p_institution_id uuid, p_passport_id uuid)
returns table (user_id uuid, full_name text, claimed_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select
    g.user_id,
    coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_app_meta_data ->> 'full_name') as full_name,
    coalesce(cc.claimed_at, g.created_at) as claimed_at
  from public.passport_guardians g
  join auth.users u on u.id = g.user_id
  left join public.passport_claim_codes cc on cc.passport_id = g.passport_id and cc.claimed_by = g.user_id
  where g.passport_id = p_passport_id
    and exists (
      select 1 from public.passport_institution_links pil
      where pil.passport_id = p_passport_id and pil.institution_id = p_institution_id
    )
    and exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = p_institution_id
        and s.user_id = auth.uid()
        and (s.role = 'principal' or (s.role = 'clinic_admin' and inst.type = 'clinic'))
        and s.deactivated_at is null
        and s.approved_at is not null
        and inst.status = 'verified'
    )
  order by claimed_at asc nulls last;
$$;

-- =====================================================================
-- 7. DECISION 6 -- strategy_bank and session_types SELECT policies had
-- no clinic-type check at all; both held only because nothing has ever
-- written a row for a school institution, not because RLS refused one.
-- Same gap this build keeps finding and closing (see 0267's own header
-- for the first instance of this exact shape, on these same two
-- helpers' write side). DROP + CREATE, matching how 0281 itself already
-- rewrites the session_types policy.
-- =====================================================================

drop policy if exists "Institution staff can view their own clinic's strategy bank" on public.strategy_bank;
create policy "Institution staff can view their own clinic's strategy bank"
  on public.strategy_bank for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = strategy_bank.institution_id
        and s.user_id = auth.uid()
        and inst.type = 'clinic'
    )
  );

drop policy if exists "Institution staff can view their own institution's session types" on public.session_types;
create policy "Institution staff can view their own institution's session types"
  on public.session_types for select to authenticated
  using (
    exists (
      select 1 from public.institution_staff s
      join public.institutions inst on inst.id = s.institution_id
      where s.institution_id = session_types.institution_id
        and s.user_id = auth.uid()
        and inst.type = 'clinic'
    )
  );
