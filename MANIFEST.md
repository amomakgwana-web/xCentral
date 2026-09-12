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
| `src/capture.js` | Live camera, image-quality maths, WebAuthn |
| `src/vision/` | Depth from parallax, face appearance, document forensics — the arithmetic behind the live capture |
| `src/localPipeline.js` | The verification pipeline as it runs with no services attached |
| `supabase/functions/agent-adjudicate/index.ts` | The six agents and the orchestrator |

## Layout

```
index.html                     the console shell: markup + the design system
src/
  supabaseClient.js            environment selection, publishable keys
  backend.js                   window.XC_DB — the only bridge to the database
  console.js                   all 16 console pages, and the capture wizard
  capture.js                   camera, sharpness/brightness/contrast, WebAuthn
  localClient.js               a client shaped like the real one, over the generated records
  localPipeline.js             identity, capture intake, reconciliation and the agents, in the page
  vision/
    image.js                   the pixel primitives everything else is built from
    face.js                    locating a face, and how alike two of them look
    depth.js                   parallax across a guided head movement: 3D from a flat camera
    document.js                is the portrait printed on this card, or stuck to it
  data/                        the generated dataset, and the arithmetic it is computed with

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
  …0015_wire_unevaluated_fraud_rules  three registered rules nothing ever evaluated
  …0016_behaviour_credit_for_late_payment  a late payer is not a defaulter
  …0017_document_forensics         what each document carries, and what a pasted portrait costs

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
  seed_demo.sql                the same shape of data, for a real database
  tests/harness.sql            stands in for a Supabase project on stock Postgres
  tests/logic_tests.sql        63 assertions
  tests/lifecycle_tests.sql    73 assertions
  tests/capture_tests.sql      34 assertions

tests/
  capture-metrics.html         image-quality maths vs synthetic images
  run-capture-metrics.mjs      runs the above in headless Chromium
  run-onboarding-wizard.mjs    the whole wizard, on Chromium's synthetic camera
  postgrest-shim.mjs           a small stand-in for Supabase's REST layer, for
                               the day the project exists. Not on the default
                               path; 501 on anything it does not truly implement
  run-dataset.mjs              the dataset: volume, referential integrity, and
                               that the figures were computed not written down
  run-console-pages.mjs        every console page, plus a case, a customer
                               profile and a stored adjudication, rendered by
                               the shipped bundle. No database.

scripts/test-db.sh             applies the schema and runs all three SQL suites
scripts/seed-demo.sh           loads all three seeds in order, with a summary
.github/workflows/ci.yml       both jobs, on every push
```

## Running it

```bash
npm install
npm run dev
```

That runs it. The console builds its own dataset in the browser — roughly
127 000 records across every module, deterministic, no database and no keys.

For a real project (`.env.example` lists every variable):

```bash
VITE_SUPABASE_URL_SANDBOX=https://<project>.supabase.co
VITE_SUPABASE_KEY_SANDBOX=sb_publishable_…
```

Both are publishable and public by design — access control is row level security
and the edge functions, not secrecy. The header says which source is answering.

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
