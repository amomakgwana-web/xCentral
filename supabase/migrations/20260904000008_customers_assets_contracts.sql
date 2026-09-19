-- ══════════════════════════════════════════════════════════════
-- Customers, the things they finance, and the agreements between.
--
-- Up to now a `subject` was someone the hub verified once. A CUSTOMER
-- is a subject in an ongoing relationship with a client platform — a
-- car dealership, a lender, a network operator. The two are kept
-- separate deliberately: one person verified once can be a customer of
-- three different platforms, and none of them should see the others'
-- relationship. The subject carries identity; the customer carries
-- commercial history.
--
-- A note on payments, because it decides the whole shape: xCentral
-- does NOT collect money. BipraPay and xPayments do that. This platform
-- records what was expected, receives what was actually paid, and
-- computes the difference — arrears, behaviour, exposure — because
-- that difference is what a credit decision is made of. Collection and
-- assessment are different jobs and belong in different systems.
-- ══════════════════════════════════════════════════════════════

-- ── Customers ───────────────────────────────────────────────────
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete restrict,
  platform_id text not null references public.client_platforms(id) on delete restrict,
  -- The platform's own customer number, so their staff can find the
  -- person by the reference they already use.
  customer_number text,
  status text not null default 'prospect' check (status in (
    'prospect',      -- enquiry, not yet verified
    'onboarding',    -- verification in flight
    'active',        -- has at least one live agreement
    'dormant',       -- verified, nothing live
    'suspended',     -- blocked pending investigation
    'closed'         -- relationship ended
  )),
  -- The case that established this customer's identity.
  onboarding_case_id text references public.verification_cases(id),
  onboarded_at timestamptz,
  -- Contactable details. Unlike the identity number these must stay
  -- usable — a lender has to be able to reach the person — so they are
  -- held in the clear and protected by RLS and the audit trail rather
  -- than by hashing.
  email text,
  preferred_contact text check (preferred_contact in ('phone','sms','email','whatsapp','post')),
  -- Free-text operational note; never a decision record.
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One customer record per person per platform.
  unique (platform_id, subject_id)
);

create index customers_platform_idx on public.customers (platform_id, status);
create index customers_subject_idx on public.customers (subject_id);
create index customers_number_idx on public.customers (platform_id, customer_number);

alter table public.customers enable row level security;

create policy "customers_select_authenticated" on public.customers
  for select to authenticated using (true);

create trigger customers_touch
  before update on public.customers
  for each row execute function public.touch_updated_at();

-- ── Assets ──────────────────────────────────────────────────────
-- The thing being financed. Modelled generically because the same
-- platform serves a dealership financing cars and an operator
-- financing handsets, but the identifiers that matter differ per type
-- and each has its own uniqueness rules.
create table public.asset_types (
  id text primary key,
  name text not null,
  category text not null check (category in ('vehicle','device','equipment','property','other')),
  -- The identifier that uniquely names one physical unit of this type.
  primary_identifier text not null,
  -- Whether the asset can be independently verified against a registry.
  registry text,
  depreciates boolean not null default true,
  active boolean not null default true
);

alter table public.asset_types enable row level security;
create policy "asset_types_select_authenticated" on public.asset_types
  for select to authenticated using (true);

insert into public.asset_types (id, name, category, primary_identifier, registry, depreciates) values
  ('vehicle_passenger', 'Passenger Vehicle',      'vehicle',  'vin',           'NaTIS', true),
  ('vehicle_commercial','Commercial Vehicle',     'vehicle',  'vin',           'NaTIS', true),
  ('motorcycle',        'Motorcycle',             'vehicle',  'vin',           'NaTIS', true),
  ('handset',           'Mobile Handset',         'device',   'imei',          'GSMA',  true),
  ('tablet',            'Tablet',                 'device',   'imei',          'GSMA',  true),
  ('laptop',            'Laptop',                 'device',   'serial_number', null,    true),
  ('equipment',         'Business Equipment',     'equipment','serial_number', null,    true),
  ('solar_system',      'Solar / Inverter System','equipment','serial_number', null,    true);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  platform_id text not null references public.client_platforms(id) on delete restrict,
  asset_type text not null references public.asset_types(id),
  make text,
  model text,
  variant text,
  year int check (year between 1900 and 2100),
  colour text,
  -- Type-specific identifiers. Only the one named by the asset type's
  -- primary_identifier is required, so a handset needs no VIN.
  vin text,
  engine_number text,
  registration_number text,
  imei text,
  serial_number text,
  -- Valuation, in cents, consistent with every other money column.
  retail_value_cents bigint,
  trade_value_cents bigint,
  valued_on date,
  odometer_km int,
  condition text check (condition in ('new','demo','used','refurbished')),
  status text not null default 'available' check (status in (
    'available','reserved','financed','repossessed','written_off','sold','returned'
  )),
  -- Registry verification: does the registry agree this asset exists,
  -- and is it free of another financier's interest?
  registry_verified boolean not null default false,
  registry_verified_at timestamptz,
  registry_status text check (registry_status in (
    'clear','encumbered','stolen','not_found','mismatch','unavailable'
  )),
  created_at timestamptz not null default now()
);

-- A VIN and an IMEI each name exactly one physical unit worldwide, so
-- two live asset records sharing one is a data error or a fraud
-- signal. Partial indexes, because the columns are null for the types
-- that do not use them.
create unique index assets_vin_uniq on public.assets (vin)
  where vin is not null and status <> 'written_off';
create unique index assets_imei_uniq on public.assets (imei)
  where imei is not null and status <> 'written_off';
create index assets_platform_idx on public.assets (platform_id, status);
create index assets_registration_idx on public.assets (registration_number)
  where registration_number is not null;

alter table public.assets enable row level security;
create policy "assets_select_authenticated" on public.assets
  for select to authenticated using (true);

-- ── NCA fee and rate caps ───────────────────────────────────────
-- Versioned for the same reason the affordability norms are: these are
-- gazetted figures that change, and a past agreement must stay
-- assessable against the caps that applied when it was written.
create table public.nca_caps (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null,
  agreement_type text not null,
  -- Initiation fee: a percentage of the amount above a threshold,
  -- plus a base, capped in absolute terms.
  initiation_base_cents bigint not null default 0,
  initiation_pct numeric(6,3) not null default 0,
  initiation_threshold_cents bigint not null default 0,
  initiation_cap_cents bigint,
  -- Monthly service fee cap.
  service_fee_cap_cents bigint,
  -- Maximum interest rate, expressed as (repo multiple + addend) so it
  -- tracks the Reserve Bank rate the way the regulations do.
  max_rate_repo_multiple numeric(6,3),
  max_rate_addend_pct numeric(6,3),
  note text,
  unique (effective_from, agreement_type)
);

alter table public.nca_caps enable row level security;
create policy "nca_caps_select_authenticated" on public.nca_caps
  for select to authenticated using (true);

-- The 2016 review of the NCA fee and rate caps. Supersede by inserting
-- a new effective_from set; never edit these rows.
insert into public.nca_caps (effective_from, agreement_type, initiation_base_cents, initiation_pct,
  initiation_threshold_cents, initiation_cap_cents, service_fee_cap_cents,
  max_rate_repo_multiple, max_rate_addend_pct, note) values
  ('2016-05-06', 'credit_facility',   16500, 10.000, 100000, 105000, 6000, 2.2, 10.0, 'Credit facilities'),
  ('2016-05-06', 'unsecured_credit',  16500, 10.000, 100000, 105000, 6000, 2.2, 21.0, 'Unsecured credit transactions'),
  ('2016-05-06', 'developmental',     16500, 10.000, 100000, 250000, 6000, 2.2, 27.0, 'Developmental credit'),
  ('2016-05-06', 'short_term',        16500, 10.000, 100000, 105000, 6000, 0.0,  5.0, 'Short term credit, monthly rate'),
  ('2016-05-06', 'mortgage',          16500, 10.000, 100000, 525000, 6000, 2.2,  5.0, 'Mortgage agreements'),
  ('2016-05-06', 'instalment_sale',   16500, 10.000, 100000, 105000, 6000, 2.2, 10.0, 'Instalment sale and lease — vehicle and asset finance'),
  ('2016-05-06', 'lease',             16500, 10.000, 100000, 105000, 6000, 2.2, 10.0, 'Lease agreements');

-- ── Contracts ───────────────────────────────────────────────────
create table public.contracts (
  id text primary key,
  customer_id uuid not null references public.customers(id) on delete restrict,
  platform_id text not null references public.client_platforms(id) on delete restrict,
  asset_id uuid references public.assets(id) on delete set null,
  agreement_type text not null default 'instalment_sale' check (agreement_type in (
    'instalment_sale','lease','rental','credit_facility','unsecured_credit',
    'short_term','mortgage','phone_contract','developmental'
  )),
  -- The verification case that supported this agreement. An NCA
  -- affordability assessment must exist before money moves, and this
  -- is the link an auditor follows to find it.
  origination_case_id text references public.verification_cases(id),
  status text not null default 'draft' check (status in (
    'draft','pending_approval','approved','active','in_arrears','defaulted',
    'legal','settled','cancelled','written_off'
  )),
  -- Money, all in cents.
  principal_cents bigint not null check (principal_cents >= 0),
  deposit_cents bigint not null default 0,
  balloon_cents bigint not null default 0,
  initiation_fee_cents bigint not null default 0,
  monthly_service_fee_cents bigint not null default 0,
  -- Annual nominal rate, as a percentage.
  interest_rate_pct numeric(7,3) not null default 0,
  rate_type text not null default 'fixed' check (rate_type in ('fixed','linked')),
  term_months int not null check (term_months > 0),
  instalment_cents bigint not null check (instalment_cents >= 0),
  -- Total the customer will have paid by the end. Disclosed under the
  -- NCA, and the number that makes the cost of credit visible.
  total_repayable_cents bigint,
  first_payment_date date,
  final_payment_date date,
  payment_day int check (payment_day between 1 and 31),
  collection_method text check (collection_method in (
    'debit_order','debicheck','eft','payroll_deduction','card','cash'
  )),
  -- Current position, maintained by the payment machinery.
  balance_cents bigint,
  arrears_cents bigint not null default 0,
  months_in_arrears int not null default 0,
  last_payment_date date,
  settled_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contracts_customer_idx on public.contracts (customer_id, status);
create index contracts_platform_idx on public.contracts (platform_id, status);
create index contracts_arrears_idx on public.contracts (months_in_arrears desc)
  where status in ('active','in_arrears','defaulted');
create index contracts_asset_idx on public.contracts (asset_id) where asset_id is not null;

alter table public.contracts enable row level security;
create policy "contracts_select_authenticated" on public.contracts
  for select to authenticated using (true);

create trigger contracts_touch
  before update on public.contracts
  for each row execute function public.touch_updated_at();

-- An asset can back only one live agreement at a time. Financing the
-- same car twice is one of the oldest frauds there is, so the database
-- refuses it rather than relying on a check somewhere in the app.
create unique index contracts_one_live_per_asset on public.contracts (asset_id)
  where asset_id is not null
    and status in ('approved','active','in_arrears','defaulted','legal');

-- ── Instalment schedule ─────────────────────────────────────────
-- What was expected, when. Generated at activation and never edited:
-- rescheduling writes a new schedule version rather than rewriting
-- history, because "what did we originally agree" is a question that
-- gets asked in disputes.
create table public.payment_schedule (
  id uuid primary key default gen_random_uuid(),
  contract_id text not null references public.contracts(id) on delete cascade,
  version int not null default 1,
  instalment_no int not null check (instalment_no > 0),
  due_date date not null,
  amount_due_cents bigint not null check (amount_due_cents >= 0),
  principal_cents bigint,
  interest_cents bigint,
  fees_cents bigint,
  -- Maintained as payments are allocated.
  amount_paid_cents bigint not null default 0,
  status text not null default 'due' check (status in (
    'due','paid','partial','missed','waived','rescheduled'
  )),
  paid_on date,
  created_at timestamptz not null default now(),
  unique (contract_id, version, instalment_no)
);

create index payment_schedule_contract_idx on public.payment_schedule (contract_id, due_date);
create index payment_schedule_overdue_idx on public.payment_schedule (due_date)
  where status in ('due','partial','missed');

alter table public.payment_schedule enable row level security;
create policy "payment_schedule_select_authenticated" on public.payment_schedule
  for select to authenticated using (true);

-- ── Amortisation ────────────────────────────────────────────────
-- The instalment for a normal amortising agreement, with an optional
-- balloon. Kept in the database so the console, the edge functions and
-- any report quote the same figure — the same discipline as
-- assess_affordability().
create or replace function public.instalment_cents(
  p_principal_cents bigint,
  p_annual_rate_pct numeric,
  p_term_months int,
  p_balloon_cents bigint default 0
)
returns bigint
language plpgsql
immutable
as $$
declare
  r numeric;      -- monthly rate
  n int;
  pv numeric;
  fv numeric;
  factor numeric;
begin
  if p_principal_cents is null or p_principal_cents <= 0 then return 0; end if;
  if p_term_months is null or p_term_months <= 0 then return 0; end if;

  n := p_term_months;
  pv := p_principal_cents;
  fv := coalesce(p_balloon_cents, 0);
  r := coalesce(p_annual_rate_pct, 0) / 100.0 / 12.0;

  -- Interest-free: principal less balloon, spread evenly.
  if r = 0 then
    return ceil((pv - fv) / n)::bigint;
  end if;

  -- Standard annuity with a future value: the balloon is discounted
  -- back and only the rest is amortised.
  factor := power(1 + r, n);
  return ceil((pv * factor - fv) * r / (factor - 1))::bigint;
end;
$$;

-- Generates the schedule for a contract. Rounding is absorbed by the
-- final instalment so the schedule sums exactly to what is owed,
-- rather than leaving a few cents that never clear.
create or replace function public.generate_payment_schedule(p_contract_id text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_version int;
  v_balance numeric;
  v_rate numeric;
  v_interest bigint;
  v_principal bigint;
  v_due date;
  i int;
  v_total bigint := 0;
begin
  select * into c from public.contracts where id = p_contract_id;
  if not found then raise exception 'Contract % not found', p_contract_id; end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.payment_schedule where contract_id = p_contract_id;

  v_balance := c.principal_cents;
  v_rate := coalesce(c.interest_rate_pct, 0) / 100.0 / 12.0;
  v_due := coalesce(c.first_payment_date, current_date);

  for i in 1..c.term_months loop
    v_interest := round(v_balance * v_rate);

    if i = c.term_months then
      -- Final instalment clears whatever is actually left, plus the
      -- balloon, so rounding never strands a balance.
      v_principal := round(v_balance);
      insert into public.payment_schedule
        (contract_id, version, instalment_no, due_date, amount_due_cents,
         principal_cents, interest_cents, fees_cents)
      values (p_contract_id, v_version, i, v_due,
              v_principal + v_interest + c.monthly_service_fee_cents,
              v_principal, v_interest, c.monthly_service_fee_cents);
      v_total := v_total + v_principal + v_interest + c.monthly_service_fee_cents;
      v_balance := 0;
    else
      v_principal := c.instalment_cents - v_interest;
      if v_principal < 0 then v_principal := 0; end if;
      insert into public.payment_schedule
        (contract_id, version, instalment_no, due_date, amount_due_cents,
         principal_cents, interest_cents, fees_cents)
      values (p_contract_id, v_version, i, v_due,
              c.instalment_cents + c.monthly_service_fee_cents,
              v_principal, v_interest, c.monthly_service_fee_cents);
      v_total := v_total + c.instalment_cents + c.monthly_service_fee_cents;
      v_balance := v_balance - v_principal;
    end if;

    v_due := v_due + interval '1 month';
  end loop;

  update public.contracts
     set total_repayable_cents = v_total + coalesce(deposit_cents, 0),
         balance_cents = principal_cents,
         final_payment_date = v_due - interval '1 month'
   where id = p_contract_id;

  return c.term_months;
end;
$$;

revoke execute on function public.generate_payment_schedule(text) from public, anon;
grant execute on function public.generate_payment_schedule(text) to service_role;
