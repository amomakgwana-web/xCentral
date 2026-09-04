// ══════════════════════════════════════════════════════════════
// Platform API key issue and revoke.
//
// The plaintext key is returned exactly once, in the response to the
// call that creates it, and is never recoverable afterwards — only
// its SHA-256 digest is stored. Losing a key means issuing a new one,
// which is the correct trade: a key that can be read back out of the
// database is a key that leaks with the database.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requireStaff, audit } from '../_shared/auth.ts';
import { sha256Hex } from '../_shared/hash.ts';

const VALID_SCOPES = ['identity', 'document', 'credit', 'biometric'];

function generateKey(environment: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  // The environment is in the key itself, so a sandbox key pasted
  // into production config is obvious on sight.
  return `xc_${environment === 'production' ? 'live' : 'test'}_${body}`;
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  const [staff, denied] = await requireStaff(req, 'api_keys');
  if (denied) return denied;

  const admin = staff.admin;
  const action = body?.action ?? 'create';

  try {
    if (action === 'revoke') {
      const { keyId } = body ?? {};
      if (!keyId) return json({ error: 'keyId is required' }, 400);

      const { data: key } = await admin
        .from('api_keys').select('id, platform_id, name, revoked_at').eq('id', keyId).maybeSingle();
      if (!key) return json({ error: `API key ${keyId} not found` }, 404);
      if (key.revoked_at) return json({ error: 'That key is already revoked' }, 409);

      const { error } = await admin
        .from('api_keys')
        .update({ revoked_at: new Date().toISOString(), revoked_by: staff.userId })
        .eq('id', keyId);
      if (error) return json({ error: error.message }, 500);

      await audit(admin, {
        actorId: staff.userId,
        action: 'api_key.revoked',
        entityType: 'api_key',
        entityId: keyId,
        metadata: { platform_id: key.platform_id, name: key.name, ip: clientIp(req) },
      });

      return json({ keyId, revoked: true });
    }

    const { platformId, name, scopes, environment = 'sandbox', expiresInDays, rateLimitPerMin = 60 } = body ?? {};
    if (!platformId) return json({ error: 'platformId is required' }, 400);
    if (!name) return json({ error: 'name is required' }, 400);
    if (!Array.isArray(scopes) || scopes.length === 0) {
      return json({ error: `scopes must be a non-empty array from: ${VALID_SCOPES.join(', ')}` }, 400);
    }
    const invalid = scopes.filter((s: string) => !VALID_SCOPES.includes(s));
    if (invalid.length > 0) return json({ error: `Unknown scopes: ${invalid.join(', ')}` }, 400);

    const { data: platform } = await admin
      .from('client_platforms').select('id, allowed_domains, status').eq('id', platformId).maybeSingle();
    if (!platform) return json({ error: `Platform ${platformId} not found` }, 404);
    if (platform.status !== 'active') {
      return json({ error: `Platform ${platformId} is ${platform.status}` }, 400);
    }

    // A key can never be broader than the platform it belongs to.
    const beyond = scopes.filter((s: string) => !platform.allowed_domains?.includes(s));
    if (beyond.length > 0) {
      return json({
        error: `Platform ${platformId} is not entitled to: ${beyond.join(', ')}`,
        allowedDomains: platform.allowed_domains,
      }, 400);
    }

    const plaintext = generateKey(environment);
    const digest = await sha256Hex(plaintext);

    let expiresAt: string | null = null;
    if (expiresInDays) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + Number(expiresInDays));
      expiresAt = d.toISOString();
    }

    const { data: key, error } = await admin
      .from('api_keys')
      .insert({
        platform_id: platformId,
        name,
        key_prefix: plaintext.slice(0, 11),
        key_last4: plaintext.slice(-4),
        key_hash: digest,
        environment,
        scopes,
        rate_limit_per_min: rateLimitPerMin,
        expires_at: expiresAt,
        created_by: staff.userId,
      })
      .select('id, key_prefix, key_last4, scopes, environment, expires_at, created_at')
      .single();
    if (error) return json({ error: error.message }, 500);

    await audit(admin, {
      actorId: staff.userId,
      action: 'api_key.issued',
      entityType: 'api_key',
      entityId: key.id,
      // The key itself is deliberately absent from the audit metadata.
      metadata: { platform_id: platformId, name, scopes, environment, ip: clientIp(req) },
    });

    return json({
      keyId: key.id,
      // Shown once. There is no endpoint that can return it again.
      apiKey: plaintext,
      warning: 'Store this key now — it cannot be retrieved again.',
      platformId,
      scopes: key.scopes,
      environment: key.environment,
      expiresAt: key.expires_at,
    });
  } catch (e) {
    console.error('manage-api-key failed', e);
    return json({ error: e instanceof Error ? e.message : 'API key operation failed' }, 500);
  }
});
