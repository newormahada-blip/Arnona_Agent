-- Survey rounds (סבבי יציאה לשטח). Every time the office sends a list of
-- properties to the surveyor it is tagged with a round number, so each field
-- trip's results can be tracked on their own (מעקב תוצאות סקר).
--
-- survey_rounds holds one row per round: its number, the day it was sent and
-- an optional note. businesses.survey_round points at the round the property
-- was last sent in; null = sent before rounds existed, or never sent.
--
-- Purely additive: a new table, a new nullable column, an index and policies.

create table if not exists public.survey_rounds (
  number     integer primary key check (number > 0),
  sent_at    date not null default current_date,
  note       text not null default '',
  created_at timestamptz not null default now()
);

alter table public.businesses
  add column if not exists survey_round integer
  references public.survey_rounds(number) on update cascade on delete set null;

create index if not exists businesses_survey_round_idx on public.businesses (survey_round);

-- Same rights as businesses (20261013_role_based_rls_lockdown.sql):
-- employee full, manager + surveyor read-only.
alter table public.survey_rounds enable row level security;
create policy employee_all on public.survey_rounds for all to authenticated
  using ((select public.app_role()) = 'employee') with check ((select public.app_role()) = 'employee');
create policy staff_read on public.survey_rounds for select to authenticated
  using ((select public.app_role()) in ('manager','surveyor'));
