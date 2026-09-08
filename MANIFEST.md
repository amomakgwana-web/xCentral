# xCentral — what is in this archive

Central Control Hub: identity, document, credit and biometric verification,
plus the customer lifecycle that follows it. The other platforms in the family
(BipraPay, xPayments, veriBills, PiggyBag, mySMME) call this rather than each
implementing KYC.

Stack: Vite + vanilla JS console, Supabase (Postgres with row level security,
Deno edge functions), Vercel. South African regulatory context throughout —
POPIA, FICA, the NCA, RICA.

`node_modules/`, `dist/` and `.git/` are excluded. `npm install` restores the
first two; the full history is on the branch `claude/tender-goodall-klf1yl`.

---

## Start here

| File | Why |
|---|---|
| `README.md` | What is real arithmetic and what needs a provider — read this first |
| `supabase/migrations/` | The schema, in order. Most of the system's guarantees are here |
| `src/capture.js` | Live camera, image-quality maths, liveness, WebAuthn |
| `supabase/functions/agent-adjudicate/index.ts` | The six agents and the orchestrator |

## Layout

```
index.html                     the console shell: markup + the design system
src/
  supabaseClient.js            environment selection, publishable keys
  backend.js                   window.XC_DB — the only bridge to the database
  console.js                   all 15 console pages
  capture.js                   camera, sharpness/brightness/contrast, liveness, WebAuthn

supabase/migrations/           applied in filename order
  …0001_init_verification_core     profiles, RBAC, subjects, cases, check ledger
  …0002_identity_verification      SA ID validation, name matching, watchlist
  …0003_document_verification      documents, private bucket, retention
  …0004_credit_verification        bureaus, NCA Reg 23A affordability
  …0005_consent_and_popia          consent register, the triggers that enforce it
  …0006_biometric_verification     templates (unreadable by clients), matching
  …0007_platform_api_and_webhooks  API keys, idempotency, case scoring
  …0008_customers_assets_contracts customers, vehicles/handsets, agreements
  …0009_payments_and_arrears       allocation, arrears, reversals, behaviour
  …0010_background_vetting         address, phone/RICA/SIM-swap, employment
  …0011_fraud_detection            23 rules, signals, alerts, fraud register
  …0012_credit_capacity_and_profile  how much credit can be given
  …0013_lifecycle_rbac_and_policies  permissions for the lifecycle domains
  …0014_capture_and_agents         capture sessions, quality gate, agents

supabase/functions/
  _shared/                     http, hash, auth, cases, mrz, providers
  verify-identity              SA ID, deceased register, watchlist, authority
  verify-document              MRZ check digits, authenticity, expiry
  verify-credit                bureau enquiry, NCA affordability
  verify-biometric             enrol, 1:1 verify, 1:N identify
  capture-intake               live capture, quality gate, templating, matching
  agent-adjudicate             the six agents and the orchestrator
  customer-onboard             verified case -> customer
  vet-background               address, phone, employment, bank account
  assess-credit-capacity       sizes the offer, stores the working
  manage-contract              origination with the affordability gate
  record-payment               machine-to-machine payment intake
  run-fraud-screen             screen, dismiss a signal, resolve an alert
  platform-verify              the endpoint sibling platforms call
  case-decision                human decision on a case
  record-consent               consent capture and withdrawal
  document-access              the only route to a stored document
  manage-api-key               issue and revoke platform keys
  webhook-dispatch             signed outbound delivery
  retention-purge              POPIA retention, executed on a schedule

supabase/
  seed.sql                     platforms, consent wording, watchlist, cases
  seed_lifecycle.sql           customers, assets, agreements, payments, fraud
  seed_demo.sql                the demonstration cohort, at demo volume
  tests/harness.sql            stands in for a Supabase project on stock Postgres
  tests/logic_tests.sql        63 assertions
  tests/lifecycle_tests.sql    60 assertions
  tests/capture_tests.sql      34 assertions

tests/
  capture-metrics.html         image-quality maths vs synthetic images
  run-capture-metrics.mjs      runs the above in headless Chromium
  run-onboarding-wizard.mjs    the whole wizard, on Chromium's synthetic camera

scripts/test-db.sh             applies the schema and runs all three SQL suites
.github/workflows/ci.yml       both jobs, on every push
```

## Running it

```bash
npm install
npm run dev
```

Point it at a Supabase project (`.env.example` lists every variable):

```bash
VITE_SUPABASE_URL_SANDBOX=https://<project>.supabase.co
VITE_SUPABASE_KEY_SANDBOX=sb_publishable_…
```

Both are publishable and public by design — access control is row level security
and the edge functions, not secrecy. Without them the console still loads and
says what is missing.

```bash
supabase db push
psql "$DATABASE_URL" -f supabase/seed.sql
psql "$DATABASE_URL" -f supabase/seed_lifecycle.sql
psql "$DATABASE_URL" -f supabase/seed_demo.sql

# or, all three in order with a summary at the end:
DATABASE_URL=... ./scripts/seed-demo.sh
```

**`ID_HASH_PEPPER` is required.** Identity hashing refuses to run without it,
rather than falling back to a reversible hash that would look identical in the
table.

## Tests

```bash
npm test              # MRZ + capture maths + all three SQL suites
npm run test:wizard   # the capture wizard end to end, needs a build first
```

157 SQL assertions, 29 MRZ assertions against the ICAO 9303 specimen documents,
9 image-quality assertions, and a full wizard run. `scripts/test-db.sh` was
verified to exit non-zero on a deliberately broken assertion, so green means
green.

## Two things to check before production

- The **NCA Regulation 23A** figures and the **2016 fee caps** are held as
  versioned rows (`affordability_norms`, `nca_caps`). I am not certain they are
  the currently gazetted values — correcting them is an insert, and past
  assessments stay reproducible against the version in force when they were made.
- **Biometric thresholds** in `biometric_modalities` are placeholder calibration
  for the simulation model. A similarity cut-off is meaningless without the model
  it was calibrated against; swapping the model requires recalibration.

Provider adapters (`supabase/functions/_shared/providers.ts`) ship a
deterministic `simulation` implementation so everything runs end to end. It is
stamped into every check row it produces and **refuses to run against a
production platform** unless explicitly overridden.
