import { createClient } from '@supabase/supabase-js';

// ── Environment selection ────────────────────────────────────────
// Same pattern as BipraPay: the bundle is static, so the environment
// is chosen at runtime from the hostname rather than at build time.
//
// Both values below are publishable keys and are public by design.
// Access control is enforced by Postgres Row Level Security and by
// the edge functions, not by keeping these secret — see
// supabase/migrations for the policies. Nothing in this file grants
// read access to a biometric template, a document image, or an
// identity number, because no client role has that access at all.

const ENVIRONMENTS = {
  production: {
    url: import.meta.env?.VITE_SUPABASE_URL_PRODUCTION ?? '',
    key: import.meta.env?.VITE_SUPABASE_KEY_PRODUCTION ?? '',
  },
  sandbox: {
    url: import.meta.env?.VITE_SUPABASE_URL_SANDBOX ?? '',
    key: import.meta.env?.VITE_SUPABASE_KEY_SANDBOX ?? '',
  },
};

const PRODUCTION_HOSTS = [
  'xcentral.co.za',
  'www.xcentral.co.za',
  'xcentral.vercel.app',
];

const isProduction = PRODUCTION_HOSTS.includes(location.hostname);
const env = isProduction ? ENVIRONMENTS.production : ENVIRONMENTS.sandbox;

export const XC_ENV = isProduction ? 'production' : 'sandbox';
export const XC_CONFIGURED = Boolean(env.url && env.key);

// When the project has not been pointed at a Supabase instance yet,
// the console still loads and says so, rather than throwing on import
// and rendering a blank page.
export const supabase = XC_CONFIGURED
  ? createClient(env.url, env.key)
  : null;
