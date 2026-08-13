/* ============================================================
   CLOSING THE LOOP -- STAGE 2 gap fix: strategy_feedback_prompts

   The teacher EOD ask-cap ("at most 3x/child/week... count asks, not
   ratings") needs to distinguish "the teacher was asked and skipped"
   from "the teacher was asked and rated" -- a skip leaves no row
   anywhere in strategy_feedback (by design, ratings are signal, a
   skip isn't). Without recording the ASK itself, a teacher who skips
   every time would never hit the cap, defeating "nag limits are hard
   requirements."

   Rolling 7-day window, not a calendar week (Mon-Sun) -- matches this
   app's own established rolling-window convention elsewhere (e.g. the
   Progress feature's "7 days" range), rather than introducing ISO-week
   edge cases nothing else in this schema uses.
   ============================================================ */

create table public.strategy_feedback_prompts (
  id uuid primary key default gen_random_uuid(),
  passport_id uuid not null references public.passports (id) on delete cascade,
  teacher_id uuid not null references auth.users (id) on delete cascade,
  prompted_at timestamptz not null default now()
);

create index strategy_feedback_prompts_passport_teacher_idx
  on public.strategy_feedback_prompts (passport_id, teacher_id, prompted_at);

alter table public.strategy_feedback_prompts enable row level security;

-- Teacher: insert + read their own prompts only. Unlike strategy_feedback's
-- ratings (protected signal, no teacher SELECT at all -- see migration
-- 0055), this is just the teacher's own rate-limit counter -- they need
-- to read it back client-side to decide whether to show the step at all
-- BEFORE incurring another ask.
create policy "Teachers can log their own strategy-feedback prompts"
  on public.strategy_feedback_prompts
  for insert
  to authenticated
  with check (
    teacher_id = auth.uid()
    and exists (
      select 1 from public.passport_access pa
      where pa.passport_id = strategy_feedback_prompts.passport_id
        and pa.teacher_id = auth.uid()
        and pa.is_active = true
    )
  );

create policy "Teachers can view their own strategy-feedback prompts"
  on public.strategy_feedback_prompts
  for select
  to authenticated
  using (teacher_id = auth.uid());

-- No UPDATE/DELETE -- immutable log, same posture as strategy_feedback
-- itself (migration 0055). No parent/clinician policy -- irrelevant to
-- those roles, this table is purely a teacher-side rate-limit counter.
