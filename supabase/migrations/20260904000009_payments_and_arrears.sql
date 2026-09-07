-- ══════════════════════════════════════════════════════════════
-- Payment monitoring.
--
-- xCentral does not take money. BipraPay and xPayments collect it and
-- report each collection here; a dealership's own bank feed can post
-- here too. What this schema owns is the comparison: what was due,
-- what actually arrived, and what that says about the customer.
--
-- Two things are modelled carefully because they are what actually
-- distinguishes a good payer from a bad one in South Africa:
--
--   Reversals. A debit order that presents and bounces is not the same
--   as a payment that never happened — it means the money was not
--   there on the day. Unpaid debit orders are recorded as their own
--   outcome and count against the customer even though the contract
--   balance ends up identical.
--
--   Allocation order. A payment clears the oldest unpaid instalment
--   first. That is what makes "three months in arrears" mean something
--   consistent rather than depending on which row happened to match.
-- ══════════════════════════════════════════════════════════════

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  contract_id text not null references public.contracts(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  -- When the money actually moved, not when we heard about it.
  paid_at timestamptz not null default now(),
  value_date date,
  method text not null default 'debit_order' check (method in (
    'debit_order','debicheck','eft','payroll_deduction','card','cash','other'
  )),
  -- Which platform collected it. Payments reconcile back to the system
  -- that took them.
  source_platform text references public.client_platforms(id),
  -- That platform's own reference, so a query can be traced across.
  external_reference text,
  status text not null default 'received' check (status in (
    'received',   -- money in
    'reversed',   -- presented and bounced, or later recalled
    'disputed',
    'unallocated' -- received but no schedule row to apply it to
  )),
  reversal_reason text,
  reversed_at timestamptz,
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index payments_contract_idx on public.payments (contract_id, paid_at desc);
create index payments_customer_idx on public.payments (customer_id, paid_at desc);
-- The same collection must not be posted twice when a platform retries.
create unique index payments_external_uniq
  on public.payments (source_platform, external_reference)
  where external_reference is not null;

alter table public.payments enable row level security;
create policy "payments_select_authenticated" on public.payments
  for select to authenticated using (true);

-- How each payment was spread across instalments. Kept explicit
-- rather than inferred, so a disputed allocation can be shown.
create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  schedule_id uuid not null references public.payment_schedule(id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);

create index payment_allocations_payment_idx on public.payment_allocations (payment_id);
create index payment_allocations_schedule_idx on public.payment_allocations (schedule_id);

alter table public.payment_allocations enable row level security;
create policy "payment_allocations_select_authenticated" on public.payment_allocations
  for select to authenticated using (true);

-- ── Allocation ──────────────────────────────────────────────────
-- Applies a payment oldest-instalment-first and returns what it did.
create or replace function public.allocate_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay record;
  sched record;
  remaining bigint;
  apply bigint;
  outstanding bigint;
  applied jsonb := '[]'::jsonb;
  v_version int;
begin
  select * into pay from public.payments where id = p_payment_id;
  if not found then raise exception 'Payment % not found', p_payment_id; end if;
  if pay.status <> 'received' then
    return jsonb_build_object('allocated_cents', 0, 'reason', 'payment_not_in_received_state');
  end if;

  -- Only the current schedule version is live; older versions are the
  -- record of what was agreed before a reschedule.
  select max(version) into v_version
  from public.payment_schedule where contract_id = pay.contract_id;

  remaining := pay.amount_cents;

  for sched in
    select * from public.payment_schedule
    where contract_id = pay.contract_id
      and version = v_version
      and status in ('due','partial','missed')
    order by due_date asc, instalment_no asc
  loop
    exit when remaining <= 0;

    outstanding := sched.amount_due_cents - sched.amount_paid_cents;
    if outstanding <= 0 then continue; end if;

    apply := least(remaining, outstanding);

    insert into public.payment_allocations (payment_id, schedule_id, amount_cents)
    values (p_payment_id, sched.id, apply);

    update public.payment_schedule
       set amount_paid_cents = amount_paid_cents + apply,
           status = case when amount_paid_cents + apply >= amount_due_cents then 'paid' else 'partial' end,
           paid_on = case when amount_paid_cents + apply >= amount_due_cents
                          then pay.paid_at::date else paid_on end
     where id = sched.id;

    applied := applied || jsonb_build_object('instalment_no', sched.instalment_no, 'amount_cents', apply);
    remaining := remaining - apply;
  end loop;

  -- Money beyond everything currently due is not lost; it sits as an
  -- unallocated credit and is applied when the next instalment falls.
  if remaining > 0 then
    update public.payments set status = 'unallocated' where id = p_payment_id;
  end if;

  perform public.recompute_contract_position(pay.contract_id);

  return jsonb_build_object(
    'allocated_cents', pay.amount_cents - remaining,
    'unallocated_cents', remaining,
    'instalments', applied
  );
end;
$$;

-- ── Contract position ───────────────────────────────────────────
-- Recomputes arrears from the schedule rather than incrementing a
-- counter, so the figure cannot drift from the underlying rows.
create or replace function public.recompute_contract_position(p_contract_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version int;
  v_arrears bigint;
  v_months int;
  v_paid bigint;
  v_principal bigint;
  v_last date;
  v_status text;
  c record;
begin
  select * into c from public.contracts where id = p_contract_id;
  if not found then raise exception 'Contract % not found', p_contract_id; end if;

  select max(version) into v_version
  from public.payment_schedule where contract_id = p_contract_id;

  -- Arrears is what has fallen due and not been paid. Instalments not
  -- yet due are not arrears, however large the remaining balance.
  select coalesce(sum(amount_due_cents - amount_paid_cents), 0),
         count(*) filter (where amount_due_cents > amount_paid_cents)
    into v_arrears, v_months
  from public.payment_schedule
  where contract_id = p_contract_id
    and version = v_version
    and due_date <= current_date
    and status <> 'waived';

  -- Anything presented and bounced does not count as paid.
  select coalesce(sum(p.amount_cents), 0), max(p.paid_at::date)
    into v_paid, v_last
  from public.payments p
  where p.contract_id = p_contract_id and p.status = 'received';

  select coalesce(sum(principal_cents), 0) into v_principal
  from public.payment_schedule
  where contract_id = p_contract_id and version = v_version and status = 'paid';

  -- Status follows the arrears position, but never walks backwards out
  -- of a terminal state a human put it in.
  if c.status in ('settled','cancelled','written_off','legal') then
    v_status := c.status;
  elsif v_arrears <= 0 and exists (
      select 1 from public.payment_schedule
      where contract_id = p_contract_id and version = v_version and status <> 'paid'
    ) then
    v_status := 'active';
  elsif v_arrears <= 0 then
    v_status := 'settled';
  elsif v_months >= 3 then
    v_status := 'defaulted';
  else
    v_status := 'in_arrears';
  end if;

  update public.contracts
     set arrears_cents = greatest(v_arrears, 0),
         months_in_arrears = greatest(v_months, 0),
         balance_cents = greatest(c.principal_cents - v_principal, 0),
         last_payment_date = v_last,
         status = v_status,
         settled_at = case when v_status = 'settled' and settled_at is null then now() else settled_at end
   where id = p_contract_id;

  return jsonb_build_object(
    'arrears_cents', greatest(v_arrears, 0),
    'months_in_arrears', greatest(v_months, 0),
    'balance_cents', greatest(c.principal_cents - v_principal, 0),
    'status', v_status,
    'total_received_cents', v_paid
  );
end;
$$;

revoke execute on function public.allocate_payment(uuid) from public, anon;
grant execute on function public.allocate_payment(uuid) to service_role;
revoke execute on function public.recompute_contract_position(text) from public, anon;
grant execute on function public.recompute_contract_position(text) to service_role, authenticated;

-- Reversing a payment must undo its allocations, not merely flag it —
-- otherwise the schedule still shows instalments as paid with money
-- that was recalled.
create or replace function public.reverse_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay record;
  alloc record;
begin
  select * into pay from public.payments where id = p_payment_id;
  if not found then raise exception 'Payment % not found', p_payment_id; end if;
  if pay.status = 'reversed' then
    return jsonb_build_object('already_reversed', true);
  end if;

  for alloc in select * from public.payment_allocations where payment_id = p_payment_id loop
    update public.payment_schedule
       set amount_paid_cents = greatest(amount_paid_cents - alloc.amount_cents, 0),
           status = case
             when greatest(amount_paid_cents - alloc.amount_cents, 0) = 0
               then (case when due_date < current_date then 'missed' else 'due' end)
             else 'partial' end,
           paid_on = null
     where id = alloc.schedule_id;
  end loop;

  delete from public.payment_allocations where payment_id = p_payment_id;

  update public.payments
     set status = 'reversed', reversal_reason = p_reason, reversed_at = now()
   where id = p_payment_id;

  perform public.recompute_contract_position(pay.contract_id);

  return jsonb_build_object('reversed', true, 'contract_id', pay.contract_id);
end;
$$;

revoke execute on function public.reverse_payment(uuid, text) from public, anon;
grant execute on function public.reverse_payment(uuid, text) to service_role;

-- ── Payment behaviour ───────────────────────────────────────────
-- The customer's track record, across every contract they hold on this
-- platform. This is what turns "they paid" into a lending signal, and
-- it is the input the credit capacity calculation cares about most —
-- a bureau score describes the past everywhere, this describes the
-- past here.
create or replace function public.payment_behaviour(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_due int; v_paid_on_time int; v_late int; v_missed int;
  v_reversals int; v_total_contracts int; v_worst int;
  v_on_time_pct numeric; v_score int; v_streak int;
begin
  select count(*) into v_total_contracts
  from public.contracts where customer_id = p_customer_id;

  if v_total_contracts = 0 then
    return jsonb_build_object('has_history', false, 'score', null,
      'reason', 'No contracts on this platform');
  end if;

  -- Only instalments that have actually fallen due can be judged.
  select
    count(*),
    count(*) filter (where s.status = 'paid' and s.paid_on <= s.due_date),
    count(*) filter (where s.status = 'paid' and s.paid_on > s.due_date),
    count(*) filter (where s.status in ('due','partial','missed'))
  into v_due, v_paid_on_time, v_late, v_missed
  from public.payment_schedule s
  join public.contracts c on c.id = s.contract_id
  where c.customer_id = p_customer_id
    and s.due_date <= current_date
    and s.status <> 'waived'
    and s.version = (select max(version) from public.payment_schedule
                     where contract_id = s.contract_id);

  select count(*) into v_reversals
  from public.payments where customer_id = p_customer_id and status = 'reversed';

  select coalesce(max(months_in_arrears), 0) into v_worst
  from public.contracts where customer_id = p_customer_id;

  -- Consecutive instalments settled on time, most recent backwards.
  select count(*) into v_streak
  from (
    select s.status, s.paid_on, s.due_date,
           row_number() over (order by s.due_date desc) rn,
           sum(case when s.status = 'paid' and s.paid_on <= s.due_date then 0 else 1 end)
             over (order by s.due_date desc rows between unbounded preceding and current row) breaks
    from public.payment_schedule s
    join public.contracts c on c.id = s.contract_id
    where c.customer_id = p_customer_id and s.due_date <= current_date and s.status <> 'waived'
  ) t
  where breaks = 0;

  if v_due = 0 then
    return jsonb_build_object('has_history', false, 'score', null,
      'contracts', v_total_contracts, 'reason', 'No instalments have fallen due yet');
  end if;

  v_on_time_pct := round((v_paid_on_time::numeric / v_due) * 100, 2);

  -- 0-100. On-time rate carries it; a reversal costs more than a late
  -- payment because it means the money was not there on the day, and
  -- deep arrears cap the score outright.
  v_score := greatest(0, least(100, round(
      v_on_time_pct
      - (v_late * 2)
      - (v_missed * 6)
      - (v_reversals * 8)
  )))::int;

  if v_worst >= 3 then v_score := least(v_score, 35); end if;

  return jsonb_build_object(
    'has_history', true,
    'contracts', v_total_contracts,
    'instalments_due', v_due,
    'paid_on_time', v_paid_on_time,
    'paid_late', v_late,
    'missed_or_short', v_missed,
    'reversals', v_reversals,
    'worst_months_in_arrears', v_worst,
    'on_time_pct', v_on_time_pct,
    'consecutive_on_time', v_streak,
    'score', v_score
  );
end;
$$;

revoke execute on function public.payment_behaviour(uuid) from public, anon;
grant execute on function public.payment_behaviour(uuid) to authenticated, service_role;
