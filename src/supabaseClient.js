import { createClient } from '@supabase/supabase-js';
import { createLocalClient } from './localClient.js';

// ── Where the data comes from ────────────────────────────────────
// One object serves the whole console. Pointed at a Supabase project
// it is production; pointed at the local client it is the same console
// running on records generated in the browser. Nothing downstream —
// backend.js, console.js, any page — knows or needs to know which.
//
// Both values below are publishable and public by design. Access
// control is Postgres row level security and the edge functions, not
// secrecy: see supabase/migrations for the policies. Nothing in this
// file grants read access to a biometric template, a document image or
// an identity number, because no client role has that access at all.

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

const isProduction = typeof location !== 'undefined'
  && PRODUCTION_HOSTS.includes(location.hostname);
const env = isProduction ? ENVIRONMENTS.production : ENVIRONMENTS.sandbox;

const hasProject = Boolean(env.url && env.key);

// Which of the two is serving this session, so the header can say so
// rather than leaving a reader to guess.
export const XC_SOURCE = hasProject ? 'project' : 'local';
export const XC_ENV = isProduction ? 'production' : hasProject ? 'sandbox' : 'local';

// The console always has a data source now, so the panel explaining
// that it has none is gone. It was only ever right when there was
// genuinely nothing to show.
export const XC_CONFIGURED = true;

export const supabase = hasProject
  ? createClient(env.url, env.key)
  : createLocalClient();
