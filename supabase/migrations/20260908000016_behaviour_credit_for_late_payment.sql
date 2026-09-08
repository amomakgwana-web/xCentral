-- ══════════════════════════════════════════════════════════════
-- Give a late payment partial credit in the behaviour score.
--
-- payment_behaviour() scored its base on the on-time rate alone and
-- then subtracted two points per late instalment. A customer who paid
-- every instalment, always about a fortnight late, therefore scored
-- zero — the same as one who had never paid at all. Both facts were
-- visible in the returned object (paid_late 12, missed_or_short 0), but
-- the single number every downstream caller reads could not tell them
-- apart, and assess_credit_capacity() reads that number.
--
-- No lender treats those two files alike. A late payment now counts as
-- 0.6 of an on-time one in the base rate.
--
-- Every penalty is a rate rather than a count, which the previous
-- formula got wrong in a way that only showed up at longer tenures: it
-- subtracted two points per late instalment while scoring the base as
-- a percentage, so forty instalments paid a fortnight late scored zero
-- — identical to never having paid, purely because the agreement had
-- been running longer. A behaviour score has to measure conduct, not
-- how long the customer has been on the book. Reversals stay absolute
-- and capped: a returned debit order is a discrete event, and five of
-- them say what fifty do.
--
-- Worked through: every instalment paid but always late scores 46
-- whether there are twelve of them or forty. Every instalment missed
-- still scores 0. Every instalment on time still scores 100.
-- ══════════════════════════════════════════════════════════════

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

  -- 0-100. The base is the settlement rate, with a late instalment
  -- counted at 60% of an on-time one: the money did arrive, and a
  -- customer who has paid every instalment a fortnight late is not the
  -- same risk as one who has paid nothing. Under the previous formula
  -- they scored identically, because lateness was excluded from the
  -- on-time rate and then penalised again on top of it, which floored
  -- any consistently-late payer at zero.
  --
  -- The per-late penalty stays: being late still costs, it just no
  -- longer costs everything. A reversal costs more than a late payment
  -- because it means the money was not there on the day, and deep
  -- arrears cap the score outright.
  v_score := greatest(0, least(100, round(
      ((v_paid_on_time + (v_late * 0.6))::numeric / v_due) * 100
      - ((v_late::numeric / v_due) * 14)
      - ((v_missed::numeric / v_due) * 30)
      - (least(v_reversals, 5) * 4)
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
