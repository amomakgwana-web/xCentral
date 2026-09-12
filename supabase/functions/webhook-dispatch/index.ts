// ══════════════════════════════════════════════════════════════
// Outbound webhook delivery.
//
// Invoked on a schedule (pg_cron or an external scheduler). Picks up
// due deliveries, signs each with the endpoint's secret, posts it,
// and either marks it delivered or backs off.
//
// The signature is over the timestamp AND the body, and the receiver
// is expected to reject a stale timestamp. Signing the body alone
// would let anyone who captured one delivery replay it forever.
// ══════════════════════════════════════════════════════════════

import { json, preflight } from '../_shared/http.ts';
import { adminClient } from '../_shared/auth.ts';
import { hmacHex } from '../_shared/hash.ts';

const MAX_ATTEMPTS = 6;
const BATCH = 25;

// Exponential backoff: 1m, 4m, 15m, 1h, 4h, then give up.
function backoffMinutes(attempt: number): number {
  return [1, 4, 15, 60, 240][Math.min(attempt, 4)];
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  // Scheduler-invoked, so it authenticates by a shared secret rather
  // than a user session.
  const expected = Deno.env.get('WEBHOOK_DISPATCH_SECRET');
  if (!expected) return json({ error: 'WEBHOOK_DISPATCH_SECRET is not configured' }, 500);
  if (req.headers.get('x-dispatch-secret') !== expected) {
    return json({ error: 'Not authorised' }, 401);
  }

  const admin = adminClient();
  const now = new Date().toISOString();

  const { data: due, error } = await admin
    .from('webhook_deliveries')
    .select('id, endpoint_id, event, case_id, payload, attempts')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', now)
    .order('next_attempt_at', { ascending: true })
    .limit(BATCH);

  if (error) return json({ error: error.message }, 500);

  let delivered = 0, failed = 0, exhausted = 0;

  for (const delivery of due ?? []) {
    const { data: endpoint } = await admin
      .from('webhook_endpoints')
      .select('id, url, secret, active')
      .eq('id', delivery.endpoint_id)
      .maybeSingle();

    if (!endpoint?.active) {
      await admin.from('webhook_deliveries')
        .update({ status: 'exhausted', response_body: 'Endpoint is inactive or removed' })
        .eq('id', delivery.id);
      exhausted++;
      continue;
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify(delivery.payload);
    const signature = await hmacHex(endpoint.secret, `${timestamp}.${rawBody}`);
    const attempts = (delivery.attempts ?? 0) + 1;

    let responseCode: number | null = null;
    let responseBody = '';

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-XCentral-Event': delivery.event,
          'X-XCentral-Delivery': delivery.id,
          'X-XCentral-Timestamp': timestamp,
          // v1=<hmac of "<timestamp>.<body>">
          'X-XCentral-Signature': `v1=${signature}`,
        },
        body: rawBody,
        signal: controller.signal,
      });
      clearTimeout(timer);

      responseCode = res.status;
      responseBody = (await res.text()).slice(0, 1000);
    } catch (e) {
      responseBody = e instanceof Error ? e.message : 'Delivery failed';
    }

    const ok = responseCode !== null && responseCode >= 200 && responseCode < 300;

    if (ok) {
      await admin.from('webhook_deliveries').update({
        status: 'delivered', attempts, response_code: responseCode,
        response_body: responseBody, delivered_at: new Date().toISOString(),
        next_attempt_at: null,
      }).eq('id', delivery.id);
      delivered++;
    } else if (attempts >= MAX_ATTEMPTS) {
      await admin.from('webhook_deliveries').update({
        status: 'exhausted', attempts, response_code: responseCode, response_body: responseBody,
      }).eq('id', delivery.id);
      exhausted++;
    } else {
      const next = new Date();
      next.setUTCMinutes(next.getUTCMinutes() + backoffMinutes(attempts - 1));
      await admin.from('webhook_deliveries').update({
        status: 'failed', attempts, response_code: responseCode,
        response_body: responseBody, next_attempt_at: next.toISOString(),
      }).eq('id', delivery.id);
      failed++;
    }
  }

  return json({ processed: due?.length ?? 0, delivered, failed, exhausted });
});
