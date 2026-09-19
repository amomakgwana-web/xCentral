// One-way digests.
//
// Identity numbers are hashed with a server-side pepper before they
// touch a table. Without the pepper, a 13-digit SA ID number has a
// small enough keyspace that a plain SHA-256 of it is reversible by
// brute force in minutes — the hash would be theatre. ID_HASH_PEPPER
// is a function secret and is never stored in the database, so a dump
// of the tables does not yield the numbers.

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function normaliseIdNumber(raw: string): string {
  return String(raw ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

export async function hashIdNumber(raw: string): Promise<string> {
  const pepper = Deno.env.get('ID_HASH_PEPPER');
  if (!pepper) {
    // Failing closed matters here: silently falling back to an
    // unpeppered hash would produce reversible values that look
    // identical to safe ones in the table.
    throw new Error('ID_HASH_PEPPER is not configured; refusing to store a reversible identifier hash');
  }
  return await sha256Hex(`${pepper}:${normaliseIdNumber(raw)}`);
}

export function last4(raw: string): string {
  const n = normaliseIdNumber(raw);
  return n.slice(-4).padStart(4, '0');
}

// HMAC-SHA256, used to sign outbound webhooks.
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time comparison, for anything an attacker could probe by
// timing (API key digests, webhook signatures).
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
