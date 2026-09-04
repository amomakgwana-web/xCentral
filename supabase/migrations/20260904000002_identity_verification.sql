-- ══════════════════════════════════════════════════════════════
-- Identity verification.
--
-- The deterministic part of identity verification is done here, in
-- Postgres, because it is pure arithmetic on the number itself and
-- should give the same answer to every caller: the SA ID check digit,
-- the encoded date of birth, gender and citizenship class.
--
-- The parts that require an authority — does the Department of Home
-- Affairs hold this record, does the photo on file match, is the
-- person deceased — are provider calls. They are recorded against the
-- registers below so that a lookup always has a local, auditable
-- answer even when an upstream provider is unreachable.
-- ══════════════════════════════════════════════════════════════

create extension if not exists pg_trgm;

-- ── SA ID number validation ─────────────────────────────────────
-- A South African ID number is 13 digits: YYMMDD SSSS C A Z
--   1-6   date of birth, YYMMDD
--   7-10  gender sequence — 0000-4999 female, 5000-9999 male
--   11    citizenship — 0 SA citizen, 1 permanent resident
--   12    historically a race classifier, now unused (8 or 9)
--   13    Luhn check digit over the preceding 12
--
-- Returns a jsonb verdict rather than a boolean so the caller gets the
-- derived attributes and the specific failure reasons in one pass.
create or replace function public.validate_sa_id(id_number text)
returns jsonb
language plpgsql
immutable
as $$
declare
  digits text;
  reasons text[] := '{}';
  total int := 0;
  d int;
  i int;
  yy int; mm int; dd int;
  dob date;
  century_year int;
  seq int;
  gender text;
  citizenship text;
  check_ok boolean := false;
begin
  digits := regexp_replace(coalesce(id_number, ''), '[^0-9]', '', 'g');

  if length(digits) <> 13 then
    return jsonb_build_object(
      'valid', false,
      'reason_codes', to_jsonb(array['id_length_invalid']),
      'date_of_birth', null, 'gender', null, 'citizenship', null
    );
  end if;

  -- Luhn over all 13 digits: every second digit from the right is
  -- doubled, and a doubled value above 9 has its digits summed.
  for i in 1..13 loop
    d := substr(digits, 14 - i, 1)::int;
    if i % 2 = 0 then
      d := d * 2;
      if d > 9 then d := d - 9; end if;
    end if;
    total := total + d;
  end loop;
  check_ok := (total % 10 = 0);
  if not check_ok then
    reasons := reasons || 'checksum_failed'::text;
  end if;

  -- Date of birth. Two-digit years are resolved against today: a year
  -- that would place the birth in the future belongs to the last century.
  yy := substr(digits, 1, 2)::int;
  mm := substr(digits, 3, 2)::int;
  dd := substr(digits, 5, 2)::int;

  century_year := 2000 + yy;
  if century_year > extract(year from current_date)::int then
    century_year := 1900 + yy;
  end if;

  begin
    dob := make_date(century_year, mm, dd);
  exception when others then
    dob := null;
    reasons := reasons || 'dob_invalid'::text;
  end;

  if dob is not null and dob > current_date then
    reasons := reasons || 'dob_in_future'::text;
  end if;

  seq := substr(digits, 7, 4)::int;
  gender := case when seq < 5000 then 'female' else 'male' end;

  citizenship := case substr(digits, 11, 1)
    when '0' then 'citizen'
    when '1' then 'permanent_resident'
    else 'unknown'
  end;
  if citizenship = 'unknown' then
    reasons := reasons || 'citizenship_digit_invalid'::text;
  end if;

  return jsonb_build_object(
    'valid', (array_length(reasons, 1) is null),
    'reason_codes', to_jsonb(reasons),
    'date_of_birth', dob,
    'age', case when dob is null then null else extract(year from age(dob))::int end,
    'gender', gender,
    'citizenship', citizenship
  );
end;
$$;

-- unaccent is not enabled on every Supabase project, so fold the few
-- accented characters that actually occur in SA name data ourselves.
-- Defined before name_match_score, which calls it.
create or replace function public.unaccent_safe(t text)
returns text
language sql
immutable
as $$
  select translate(coalesce(t, ''),
    'àáâãäåèéêëìíîïòóôõöùúûüýÿñçÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÑÇ',
    'aaaaaaeeeeiiiiooooouuuuyyncAAAAAAEEEEIIIIOOOOOUUUUYNC');
$$;

-- Name comparison for "does the name given match the name on the
-- record". Compares on a normalised form so that case, punctuation,
-- accents and name order do not produce false mismatches. Returns
-- 0-100 rather than 0-1 to match the scoring used everywhere else.
create or replace function public.name_match_score(a text, b text)
returns numeric
language sql
immutable
as $$
  with norm as (
    select
      btrim(regexp_replace(regexp_replace(lower(public.unaccent_safe(coalesce(a, ''))), '[^a-z ]', ' ', 'g'), ' +', ' ', 'g')) as na,
      btrim(regexp_replace(regexp_replace(lower(public.unaccent_safe(coalesce(b, ''))), '[^a-z ]', ' ', 'g'), ' +', ' ', 'g')) as nb
  ),
  sorted as (
    -- Sorting the tokens makes "Thabo Mokoena" and "Mokoena Thabo" equal.
    select
      (select string_agg(u.tok, ' ' order by u.tok) from unnest(string_to_array(na, ' ')) as u(tok)) as sa,
      (select string_agg(u.tok, ' ' order by u.tok) from unnest(string_to_array(nb, ' ')) as u(tok)) as sb
    from norm
  )
  select case
    when sa is null or sb is null or sa = '' or sb = '' then 0::numeric
    when sa = sb then 100::numeric
    else round((similarity(sa, sb) * 100)::numeric, 2)
  end
  from sorted;
$$;

-- ── Identity verification detail ────────────────────────────────
create table public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references public.verification_cases(id) on delete cascade,
  check_id uuid references public.verification_checks(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete restrict,
  id_type text not null default 'sa_id',
  id_last4 text,
  -- Structural verdict from validate_sa_id / MRZ parse.
  structure_valid boolean,
  derived_date_of_birth date,
  derived_gender text,
  derived_citizenship text,
  -- Claimed vs. authority-held name, scored 0-100.
  claimed_name text,
  authority_name text,
  name_match_score numeric(5,2),
  -- Authority lookup outcome.
  authority_provider text default 'simulation',
  authority_status text default 'not_run'
    check (authority_status in ('not_run','match','no_match','not_found','unavailable','error')),
  deceased_flag boolean not null default false,
  watchlist_hit boolean not null default false,
  created_at timestamptz not null default now()
);

create index identity_verifications_case_idx on public.identity_verifications (case_id);

alter table public.identity_verifications enable row level security;

create policy "identity_verifications_select_authenticated" on public.identity_verifications
  for select to authenticated using (true);

-- ── Deceased register ───────────────────────────────────────────
-- Mirrored from the Home Affairs deceased-persons feed. Held as
-- hashes only: the hub never needs the plaintext number to answer
-- "is this subject on the register".
create table public.deceased_register (
  id_hash text primary key,
  date_of_death date,
  source text not null default 'dha_feed',
  loaded_at timestamptz not null default now()
);

alter table public.deceased_register enable row level security;

create policy "deceased_register_select_authenticated" on public.deceased_register
  for select to authenticated using (true);

-- ── Sanctions / PEP watchlist ───────────────────────────────────
-- Screening source for FIC obligations. Names are held in the clear
-- because the lists themselves are public instruments.
create table public.watchlist_entries (
  id uuid primary key default gen_random_uuid(),
  list_name text not null,
  entry_type text not null default 'sanction' check (entry_type in ('sanction','pep','adverse_media','internal_deny')),
  full_name text not null,
  aliases text[] not null default '{}',
  country text,
  date_of_birth date,
  notes text,
  active boolean not null default true,
  loaded_at timestamptz not null default now()
);

create index watchlist_entries_name_trgm on public.watchlist_entries using gin (full_name gin_trgm_ops);

alter table public.watchlist_entries enable row level security;

create policy "watchlist_entries_select_authenticated" on public.watchlist_entries
  for select to authenticated using (true);

create table public.watchlist_hits (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references public.verification_cases(id) on delete cascade,
  entry_id uuid not null references public.watchlist_entries(id),
  match_score numeric(5,2) not null,
  status text not null default 'open' check (status in ('open','false_positive','confirmed')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

create index watchlist_hits_case_idx on public.watchlist_hits (case_id);

alter table public.watchlist_hits enable row level security;

create policy "watchlist_hits_select_authenticated" on public.watchlist_hits
  for select to authenticated using (true);

-- Screens a name against the active watchlist, including aliases.
-- Returns only entries above the threshold, best match first.
create or replace function public.screen_watchlist(subject_name text, threshold numeric default 82)
returns table (entry_id uuid, list_name text, entry_type text, matched_name text, match_score numeric)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.list_name, e.entry_type, m.candidate,
         public.name_match_score(subject_name, m.candidate) as score
  from public.watchlist_entries e
  cross join lateral (
    select unnest(array[e.full_name] || e.aliases) as candidate
  ) m
  where e.active
    and public.name_match_score(subject_name, m.candidate) >= threshold
  order by score desc
  limit 25;
$$;

revoke execute on function public.screen_watchlist(text, numeric) from public, anon;
grant execute on function public.screen_watchlist(text, numeric) to authenticated;
-- The edge functions call this as service_role, whose implicit grant the
-- REVOKE above also removed.
grant execute on function public.screen_watchlist(text, numeric) to service_role;
