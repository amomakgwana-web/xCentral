-- ══════════════════════════════════════════════════════════════
-- Background vetting: where they live, the number they gave, and who
-- pays them.
--
-- Each of these is a claim the applicant makes, and each has a
-- different way of being false. The schema is built around that:
--
--   Address — the common failures are a proof of residence in someone
--   else's name, and one address quietly serving a dozen unrelated
--   applicants. So addresses are normalised to a canonical hash, which
--   makes the second detectable across the whole platform.
--
--   Phone — under RICA a SIM is registered to a person, so "is this
--   number registered to the applicant" is answerable. The signal that
--   matters most, though, is a RECENT SIM SWAP: control of the number
--   is what one-time passwords and account recovery rest on, and a swap
--   days before an application is a takeover pattern, not a coincidence.
--
--   Employment — a payslip is trivially forged, so the check is not
--   "does the document look right" but "does this employer exist at
--   CIPC, and does the income agree with what the bank statement
--   shows". The arithmetic on the payslip itself is also checkable and
--   is done here.
-- ══════════════════════════════════════════════════════════════

-- ── Addresses ───────────────────────────────────────────────────
create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete cascade,
  address_type text not null default 'residential' check (address_type in (
    'residential','postal','work','delivery','previous'
  )),
  line1 text not null,
  line2 text,
  suburb text,
  city text,
  province text check (province in (
    'Eastern Cape','Free State','Gauteng','KwaZulu-Natal','Limpopo',
    'Mpumalanga','Northern Cape','North West','Western Cape'
  )),
  postal_code text,
  country text not null default 'ZA',
  latitude numeric(9,6),
  longitude numeric(9,6),
  -- Canonical form, so the same place written three ways collapses to
  -- one value. This is what makes shared-address detection work.
  address_hash text not null,
  resident_since date,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

create index addresses_customer_idx on public.addresses (customer_id) where is_current;
create index addresses_hash_idx on public.addresses (address_hash);

alter table public.addresses enable row level security;
create policy "addresses_select_authenticated" on public.addresses
  for select to authenticated using (true);

-- Canonical address form. Case, punctuation, and the usual street-type
-- and unit abbreviations are folded so that "12 Main Rd, Apt 3" and
-- "Unit 3, 12 Main Road" reduce to the same string.
create or replace function public.normalise_address(
  p_line1 text, p_line2 text, p_suburb text, p_city text, p_postal text
)
returns text
language sql
immutable
as $$
  select regexp_replace(
    btrim(
      regexp_replace(
        lower(public.unaccent_safe(
          coalesce(p_line1,'') || ' ' || coalesce(p_line2,'') || ' ' ||
          coalesce(p_suburb,'') || ' ' || coalesce(p_city,'') || ' ' || coalesce(p_postal,'')
        )),
        '[^a-z0-9 ]', ' ', 'g'
      )
    ),
    ' +', ' ', 'g'
  );
$$;

create or replace function public.address_fingerprint(
  p_line1 text, p_line2 text, p_suburb text, p_city text, p_postal text
)
returns text
language sql
immutable
as $$
  with words as (
    select unnest(string_to_array(
      public.normalise_address(p_line1, p_line2, p_suburb, p_city, p_postal), ' ')) w
  ),
  folded as (
    -- Street types and unit words vary by writer and carry no
    -- identifying information; drop or standardise them.
    select case w
      when 'road' then 'rd' when 'street' then 'st' when 'avenue' then 'ave'
      when 'drive' then 'dr' when 'crescent' then 'cres' when 'boulevard' then 'blvd'
      when 'place' then 'pl' when 'lane' then 'ln' when 'close' then 'cl'
      when 'apartment' then 'unit' when 'apt' then 'unit' when 'flat' then 'unit'
      when 'number' then '' when 'no' then '' when 'the' then ''
      else w end as w
    from words
  )
  select coalesce(
    (select string_agg(w, ' ' order by w) from folded where w <> ''),
    ''
  );
$$;

-- Keeps address_hash correct without trusting the caller to compute it.
create or replace function public.set_address_hash()
returns trigger
language plpgsql
as $$
begin
  new.address_hash := public.address_fingerprint(
    new.line1, new.line2, new.suburb, new.city, new.postal_code);
  return new;
end;
$$;

create trigger addresses_hash
  before insert or update on public.addresses
  for each row execute function public.set_address_hash();

create table public.address_verifications (
  id uuid primary key default gen_random_uuid(),
  address_id uuid not null references public.addresses(id) on delete cascade,
  case_id text references public.verification_cases(id) on delete set null,
  check_id uuid references public.verification_checks(id) on delete set null,
  -- How the address was corroborated. They are not equally strong, and
  -- the confidence reflects that.
  method text not null check (method in (
    'utility_bill','bank_statement','municipal_account','lease_agreement',
    'credit_bureau','physical_visit','geolocation','postal_confirmation','third_party_data'
  )),
  -- Whether the corroborating document was in the applicant's own name.
  document_in_subject_name boolean,
  document_id uuid references public.documents(id) on delete set null,
  document_date date,
  status text not null default 'pending' check (status in (
    'pending','verified','failed','manual_review','unavailable'
  )),
  confidence numeric(5,2) check (confidence between 0 and 100),
  -- How many other unrelated customers share this exact address.
  shared_with_count int not null default 0,
  reason_codes text[] not null default '{}',
  provider text not null default 'simulation',
  created_at timestamptz not null default now()
);

create index address_verifications_address_idx on public.address_verifications (address_id);

alter table public.address_verifications enable row level security;
create policy "address_verifications_select_authenticated" on public.address_verifications
  for select to authenticated using (true);

-- How many other subjects claim this same address. A block of flats
-- legitimately shares a street address, which is why this reports a
-- number for a human to weigh rather than returning a verdict.
create or replace function public.address_shared_count(p_address_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct coalesce(a2.subject_id, c2.subject_id))::int
  from public.addresses a1
  join public.addresses a2 on a2.address_hash = a1.address_hash and a2.id <> a1.id
  left join public.customers c2 on c2.id = a2.customer_id
  where a1.id = p_address_id
    and coalesce(a2.subject_id, c2.subject_id) is distinct from
        (select coalesce(a.subject_id, c.subject_id)
         from public.addresses a left join public.customers c on c.id = a.customer_id
         where a.id = p_address_id);
$$;

revoke execute on function public.address_shared_count(uuid) from public, anon;
grant execute on function public.address_shared_count(uuid) to authenticated, service_role;

-- ── Phone numbers ───────────────────────────────────────────────
create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete cascade,
  -- Stored in E.164. Unlike an identity number this has to stay usable
  -- — the lender must be able to phone the customer — so it is held in
  -- the clear and protected by RLS and the audit trail.
  msisdn text not null,
  -- Hashed alongside, so the same number appearing under two different
  -- identities is detectable the same way a reused document is.
  msisdn_hash text not null,
  network text,
  line_type text check (line_type in ('mobile_prepaid','mobile_contract','landline','voip','unknown')),
  is_primary boolean not null default true,
  created_at timestamptz not null default now()
);

create index phone_numbers_customer_idx on public.phone_numbers (customer_id);
create index phone_numbers_hash_idx on public.phone_numbers (msisdn_hash);

alter table public.phone_numbers enable row level security;
create policy "phone_numbers_select_authenticated" on public.phone_numbers
  for select to authenticated using (true);

-- South African numbers arrive as 082…, 082 123 4567, +2782…, 002782….
-- All of them normalise to +2782… so the same line is one value.
create or replace function public.normalise_msisdn(p_raw text, p_default_country text default '27')
returns text
language plpgsql
immutable
as $$
declare
  d text;
begin
  d := regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g');
  if d = '' then return null; end if;

  -- International prefix written as 00.
  if left(d, 2) = '00' then d := substr(d, 3); end if;

  -- National form: a leading 0 replaced by the country code.
  if left(d, 1) = '0' then
    d := p_default_country || substr(d, 2);
  elsif left(d, length(p_default_country)) <> p_default_country then
    -- Bare subscriber number with no prefix at all.
    if length(d) = 9 then d := p_default_country || d; end if;
  end if;

  return '+' || d;
end;
$$;

create table public.phone_verifications (
  id uuid primary key default gen_random_uuid(),
  phone_id uuid not null references public.phone_numbers(id) on delete cascade,
  case_id text references public.verification_cases(id) on delete set null,
  check_id uuid references public.verification_checks(id) on delete set null,
  -- RICA: is the SIM registered, and to whom?
  rica_status text check (rica_status in (
    'registered_to_subject','registered_to_other','not_registered','not_found','unavailable'
  )),
  registered_name text,
  name_match_score numeric(5,2),
  -- Control-of-number signals. A swap or a port shortly before an
  -- application is the pattern behind most account takeovers.
  last_sim_swap_at timestamptz,
  days_since_sim_swap int,
  last_ported_at timestamptz,
  tenure_days int,
  -- Reachability, which is a weaker but still useful signal.
  otp_delivered boolean,
  otp_confirmed boolean,
  status text not null default 'pending' check (status in (
    'pending','verified','failed','manual_review','unavailable'
  )),
  confidence numeric(5,2) check (confidence between 0 and 100),
  reason_codes text[] not null default '{}',
  provider text not null default 'simulation',
  created_at timestamptz not null default now()
);

create index phone_verifications_phone_idx on public.phone_verifications (phone_id);

alter table public.phone_verifications enable row level security;
create policy "phone_verifications_select_authenticated" on public.phone_verifications
  for select to authenticated using (true);

-- ── Employers and employment ────────────────────────────────────
-- Employers are a shared registry rather than a column on the
-- employment record, so that "eleven applicants all work for a company
-- that does not exist at CIPC" is a query rather than an anecdote.
create table public.employers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_normalised text not null,
  -- CIPC company registration, e.g. 2015/123456/07.
  registration_number text,
  cipc_status text check (cipc_status in (
    'in_business','deregistered','in_liquidation','not_found','unverified','unavailable'
  )),
  cipc_checked_at timestamptz,
  sector text,
  contact_phone text,
  contact_email text,
  -- Set when this employer has been implicated in confirmed fraud.
  flagged boolean not null default false,
  flag_reason text,
  created_at timestamptz not null default now(),
  unique (name_normalised, registration_number)
);

create index employers_normalised_idx on public.employers (name_normalised);

alter table public.employers enable row level security;
create policy "employers_select_authenticated" on public.employers
  for select to authenticated using (true);

create table public.employment_records (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete cascade,
  employer_id uuid references public.employers(id) on delete set null,
  employer_name_claimed text,
  job_title text,
  employment_type text check (employment_type in (
    'permanent','fixed_term','contract','probation','self_employed','pensioner','unemployed','informal'
  )),
  started_on date,
  ended_on date,
  is_current boolean not null default true,
  -- Declared figures, in cents.
  gross_monthly_cents bigint,
  net_monthly_cents bigint,
  pay_frequency text check (pay_frequency in ('monthly','fortnightly','weekly','irregular')),
  pay_day int check (pay_day between 1 and 31),
  created_at timestamptz not null default now()
);

create index employment_customer_idx on public.employment_records (customer_id) where is_current;
create index employment_employer_idx on public.employment_records (employer_id);

alter table public.employment_records enable row level security;
create policy "employment_records_select_authenticated" on public.employment_records
  for select to authenticated using (true);

create table public.employment_verifications (
  id uuid primary key default gen_random_uuid(),
  employment_id uuid not null references public.employment_records(id) on delete cascade,
  case_id text references public.verification_cases(id) on delete set null,
  check_id uuid references public.verification_checks(id) on delete set null,
  method text not null check (method in (
    'payslip','bank_statement','employer_confirmation','cipc_lookup',
    'uif_declaration','sars_irp5','third_party_data'
  )),
  document_id uuid references public.documents(id) on delete set null,
  -- Does the employer exist, and is it trading?
  employer_exists boolean,
  -- Payslip arithmetic: gross minus deductions should equal net. It is
  -- remarkable how often a forged payslip fails this.
  payslip_arithmetic_ok boolean,
  declared_gross_cents bigint,
  declared_net_cents bigint,
  computed_net_cents bigint,
  -- Corroboration against money actually arriving in the bank account.
  observed_deposit_cents bigint,
  income_variance_pct numeric(7,2),
  status text not null default 'pending' check (status in (
    'pending','verified','failed','manual_review','unavailable'
  )),
  confidence numeric(5,2) check (confidence between 0 and 100),
  reason_codes text[] not null default '{}',
  provider text not null default 'simulation',
  created_at timestamptz not null default now()
);

create index employment_verifications_employment_idx
  on public.employment_verifications (employment_id);

alter table public.employment_verifications enable row level security;
create policy "employment_verifications_select_authenticated" on public.employment_verifications
  for select to authenticated using (true);

-- Payslip arithmetic. Real, decidable, and one of the cheapest ways to
-- catch a fabricated document: a forger who edits the gross rarely
-- recomputes the deductions.
create or replace function public.check_payslip_arithmetic(
  p_gross_cents bigint,
  p_deductions jsonb,      -- [{"label": "PAYE", "amount_cents": 412300}, …]
  p_net_cents bigint,
  p_tolerance_cents bigint default 200
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_total_deductions bigint := 0;
  v_computed bigint;
  v_diff bigint;
  d jsonb;
  reasons text[] := '{}';
begin
  if p_gross_cents is null or p_net_cents is null then
    return jsonb_build_object('ok', null, 'reason_codes', to_jsonb(array['payslip_incomplete']));
  end if;

  for d in select * from jsonb_array_elements(coalesce(p_deductions, '[]'::jsonb)) loop
    v_total_deductions := v_total_deductions + coalesce((d->>'amount_cents')::bigint, 0);
  end loop;

  v_computed := p_gross_cents - v_total_deductions;
  v_diff := abs(v_computed - p_net_cents);

  if v_diff > p_tolerance_cents then
    reasons := reasons || 'payslip_net_does_not_reconcile'::text;
  end if;
  if v_total_deductions = 0 and p_gross_cents <> p_net_cents then
    reasons := reasons || 'payslip_no_deductions_listed'::text;
  end if;
  -- Nobody's net pay exceeds their gross.
  if p_net_cents > p_gross_cents then
    reasons := reasons || 'payslip_net_exceeds_gross'::text;
  end if;

  return jsonb_build_object(
    'ok', array_length(reasons, 1) is null,
    'total_deductions_cents', v_total_deductions,
    'computed_net_cents', v_computed,
    'declared_net_cents', p_net_cents,
    'difference_cents', v_diff,
    'reason_codes', to_jsonb(reasons)
  );
end;
$$;
