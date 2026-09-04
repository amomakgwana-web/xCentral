// ══════════════════════════════════════════════════════════════
// Two ways into the hub, with different trust models.
//
//   Staff — a Supabase session from the console. Authorisation is
//   has_permission(), the same function the RLS policies use, so the
//   console and the database never disagree about what a role allows.
//
//   Platform — a sibling system (BipraPay, xPayments, veriBills)
//   presenting an API key. A platform has no Supabase identity at
//   all; it is bounded by its key's scopes and the platform's
//   allowed_domains, and every call is logged to api_requests.
// ══════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { sha256Hex, timingSafeEqual } from './hash.ts';
import { json } from './http.ts';

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

export function userClient(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );
}

export interface StaffContext {
  userId: string;
  client: SupabaseClient;
  admin: SupabaseClient;
}

// Authenticates a console user and checks one permission. Returns
// either the context or the Response to send back.
export async function requireStaff(
  req: Request,
  permission: string,
): Promise<[StaffContext, null] | [null, Response]> {
  const client = userClient(req);
  const { data: { user } } = await client.auth.getUser();
  if (!user) return [null, json({ error: 'Not authenticated' }, 401)];

  const { data: allowed } = await client.rpc('has_permission', { perm: permission });
  if (!allowed) {
    return [null, json({ error: `Your role does not have the '${permission}' permission` }, 403)];
  }

  return [{ userId: user.id, client, admin: adminClient() }, null];
}

export interface PlatformContext {
  platformId: string;
  platformName: string;
  environment: string;
  apiKeyId: string;
  scopes: string[];
  allowedDomains: string[];
  admin: SupabaseClient;
}

// Authenticates a calling platform by API key.
//
// The key is looked up by its SHA-256 digest, so the plaintext is
// never stored and a table dump does not yield working credentials.
// The digest comparison is constant-time even though the lookup is by
// index, because the index tells an attacker nothing they can time.
export async function requirePlatform(
  req: Request,
  domain: string,
): Promise<[PlatformContext, null] | [null, Response]> {
  const presented = req.headers.get('x-api-key') ?? '';
  if (!presented) return [null, json({ error: 'Missing x-api-key header' }, 401)];

  const admin = adminClient();
  const digest = await sha256Hex(presented);

  const { data: key } = await admin
    .from('api_keys')
    .select('id, platform_id, key_hash, scopes, environment, revoked_at, expires_at')
    .eq('key_hash', digest)
    .maybeSingle();

  if (!key || !timingSafeEqual(key.key_hash, digest)) {
    return [null, json({ error: 'Invalid API key' }, 401)];
  }
  if (key.revoked_at) return [null, json({ error: 'API key has been revoked' }, 401)];
  if (key.expires_at && new Date(key.expires_at) < new Date()) {
    return [null, json({ error: 'API key has expired' }, 401)];
  }

  const { data: platform } = await admin
    .from('client_platforms')
    .select('id, name, status, environment, allowed_domains')
    .eq('id', key.platform_id)
    .maybeSingle();

  if (!platform) return [null, json({ error: 'Calling platform not found' }, 401)];
  if (platform.status !== 'active') {
    return [null, json({ error: `Platform ${platform.id} is ${platform.status}` }, 403)];
  }

  // Two independent gates: what the platform may ever do, and what
  // this particular key may do. Both must allow the domain.
  if (!platform.allowed_domains?.includes(domain)) {
    return [null, json({ error: `Platform ${platform.id} is not entitled to ${domain} verification` }, 403)];
  }
  if (!key.scopes?.includes(domain)) {
    return [null, json({ error: `This API key does not carry the '${domain}' scope` }, 403)];
  }

  // Best-effort: a failed touch must not fail the request.
  await admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', key.id);

  return [{
    platformId: platform.id,
    platformName: platform.name,
    environment: platform.environment,
    apiKeyId: key.id,
    scopes: key.scopes ?? [],
    allowedDomains: platform.allowed_domains ?? [],
    admin,
  }, null];
}

// Append-only audit entry. Never throws: an audit write failing must
// not roll back the action it describes, but it must be visible.
export async function audit(
  admin: SupabaseClient,
  entry: {
    actorId?: string | null;
    actorPlatform?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    await admin.from('audit_log').insert({
      actor_id: entry.actorId ?? null,
      actor_platform: entry.actorPlatform ?? null,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch (e) {
    console.error('audit_log write failed', entry.action, e);
  }
}

// Records the inbound API call. Also best-effort.
export async function logApiRequest(
  admin: SupabaseClient,
  entry: {
    apiKeyId?: string | null;
    platformId?: string | null;
    endpoint: string;
    caseId?: string | null;
    statusCode: number;
    errorCode?: string | null;
    ip?: string;
    latencyMs?: number;
  },
) {
  try {
    await admin.from('api_requests').insert({
      api_key_id: entry.apiKeyId ?? null,
      platform_id: entry.platformId ?? null,
      endpoint: entry.endpoint,
      case_id: entry.caseId ?? null,
      status_code: entry.statusCode,
      error_code: entry.errorCode ?? null,
      ip: entry.ip ?? null,
      latency_ms: entry.latencyMs ?? null,
    });
  } catch (e) {
    console.error('api_requests write failed', entry.endpoint, e);
  }
}

// Sequential, human-readable case identifiers: VC-2026-000123.
// Collisions are resolved by retry rather than by a sequence, because
// the id embeds the year and must restart each January.
export async function nextCaseId(admin: SupabaseClient): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `VC-${year}-`;
  const { data } = await admin
    .from('verification_cases')
    .select('id')
    .like('id', `${prefix}%`)
    .order('id', { ascending: false })
    .limit(1);

  const lastSeq = data?.[0]?.id ? Number(String(data[0].id).slice(prefix.length)) : 0;
  return `${prefix}${String((Number.isFinite(lastSeq) ? lastSeq : 0) + 1).padStart(6, '0')}`;
}
