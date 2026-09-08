# xCentral — Verification Hub

Central Control Hub for identity, document, credit and biometric verification.

The other platforms in this family — BipraPay, xPayments, veriBills, PiggyBag,
mySMME — do not each implement KYC. They hold an API key, call xCentral, and get
back a decision. One consent register, one audit trail, one place where an
identity number is handled, and one definition of what "standard assurance"
means.

Built on the same stack as its siblings: Vite + vanilla JS console, Supabase
(Postgres with row level security, Deno edge functions), deployed on Vercel.
The design tokens and class names in `index.html` are BipraPay's, so the two
consoles read as one product family.

---

## What is real, and what needs a provider

This distinction is the most important thing in the repository, so it is stated
plainly rather than buried.

**Decided here, by arithmetic we own.** These are correct, tested, and no
provider can disagree with them:

| Check | Where | Tests |
|---|---|---|
| SA ID check digit, date of birth, gender, citizenship | `validate_sa_id()` | `supabase/tests/logic_tests.sql` |
| ICAO 9303 MRZ parsing and every check digit (TD1, TD3) | `_shared/mrz.ts` | `_shared/mrz.test.ts` |
| Name matching, order- and accent-insensitive | `name_match_score()` | `logic_tests.sql` |
| NCA Regulation 23A minimum expenses and affordability | `assess_affordability()` | `logic_tests.sql` |
| Template comparison (cosine similarity), 1:N sweep | `cosine_similarity()`, `biometric_identify()` | `logic_tests.sql` |
| Document expiry and staleness | `verify-document` | — |
| Composite case scoring and status | `case_score()` | `logic_tests.sql` |
| Consent enforcement | database triggers | `logic_tests.sql` |
| Amortisation, schedules, balloon payments | `instalment_cents()` | `lifecycle_tests.sql` |
| Payment allocation, arrears, reversals | `allocate_payment()` | `lifecycle_tests.sql` |
| Payment behaviour scoring | `payment_behaviour()` | `lifecycle_tests.sql` |
| Payslip arithmetic | `check_payslip_arithmetic()` | `lifecycle_tests.sql` |
| Address and phone normalisation | `address_fingerprint()`, `normalise_msisdn()` | `lifecycle_tests.sql` |
| Fraud rules and linkage detection | `run_fraud_screen()` | `lifecycle_tests.sql` |
| Credit capacity and lending limits | `assess_credit_capacity()` | `lifecycle_tests.sql` |
| Image quality — sharpness, brightness, contrast | `src/capture.js` | `tests/capture-metrics.html` |
| Capture quality gate and remedies | `assess_capture_quality()` | `capture_tests.sql` |
| Capture session state machine | `complete_capture_step()` | `capture_tests.sql` |

**Requires an authority we do not have offline.** These run through the
provider adapters in `_shared/providers.ts`:

| Check | Real provider would be |
|---|---|
| Does Home Affairs hold this record | DHA / HANIS |
| Is this SIM registered to them, and when was it last swapped | Network / RICA aggregator |
| Does this employer exist | CIPC |
| Is this bank account theirs | Account verification service |
| Is this vehicle clear of another financier's interest | NaTIS |
| Face templating and matching | An ISO/IEC 30107-3 certified biometric SDK |
| Fingerprint capture beyond the device's own sensor | A scanner SDK |
| Is the document image genuine (tamper, security features) | A document-authentication vendor |
| Credit bureau enquiry | TransUnion, Experian, XDS, VeriCred |
| Face templating and liveness (PAD) | An ISO/IEC 30107-3 certified SDK |

A `simulation` adapter ships so the sandbox, the console and the tests all work
end to end. It is deterministic — the same input always gives the same answer —
and it is **fenced**:

- every simulated result is stamped `provider = 'simulation'` in
  `verification_checks`, visibly and permanently;
- `assertLiveProvider()` **refuses** to run the simulation against a production
  platform unless `XCENTRAL_ALLOW_SIMULATION_IN_PROD=true` is explicitly set. It
  throws rather than quietly returning a plausible number.

The one genuinely dangerous failure mode for a verification system is a
fabricated result being mistaken for a real one. The fence exists for that.

I am not certain the NCA Regulation 23A figures in
`20260904000004_credit_verification.sql` are the currently gazetted ones —
they are the 2015 table as published. They are held as **versioned rows**
precisely so this is a data correction rather than a code change, and past
assessments stay reproducible against the version in force when they were made.

---

## Design commitments

**The identity number is never stored.** Only a peppered SHA-256 hash, the last
four digits, and the attributes the number encodes. `ID_HASH_PEPPER` is a
function secret and is never in the database, so a dump of the tables does not
yield the numbers. Without a pepper a 13-digit ID number is reversible by brute
force in minutes, so `hashIdNumber()` **throws** rather than fall back to an
unpeppered hash that would look identical in the table. Same principle as
BipraPay's card vault.

**Biometric templates are unreadable by the application.**
`biometric_templates` has row level security enabled and *no policies at all* —
every client role gets zero rows, always. Only the service role, i.e. the edge
functions, can read a template, and they only ever return a score. No raw
sample is stored anywhere.

**Consent is a database precondition, not a checkbox.** Triggers on
`credit_checks` and `biometric_templates` reject the write outright when no live
consent covers it. "We processed biometrics without consent" is a constraint
violation, not a bug a careless edge function can introduce. POPIA s26 marking
is automatic; s27 will not accept legitimate interest for biometrics.

**Liveness is evaluated before the match, and a failure stops there.** Matching
a photograph of a photograph against a template succeeds — the template does not
know nobody was present. When liveness fails, no similarity is computed and none
is returned.

**Documents are unreachable by URL.** The bucket is private with no client
policy. Access goes through `document-access`, which checks the permission,
demands a written reason, logs it, and mints a signed URL lasting at most five
minutes.

**The audit log cannot be rewritten.** Select policy only, no insert/update/
delete for any client role.

**Retention is executed, not merely declared.** `retention-purge` deletes
document objects, deactivates templates past retention *or* whose consent
lapsed, and expires cases. It supports `dryRun` (the default) so the first run
against real data can be inspected.

---

## Customer lifecycle

Verification establishes who someone is. The lifecycle domains are what a
lender or dealership does next, and they share the same schema, audit trail and
consent register.

**Customers.** A subject is someone the hub verified; a *customer* is that
subject in an ongoing relationship with one platform. The same person can be a
customer of the dealership and the lender without either seeing the other's
relationship — identity is shared, commercial history is not. A customer cannot
be created from an unverified case.

**Assets and agreements.** Vehicles by VIN, handsets by IMEI, equipment by
serial. A partial unique index refuses two live agreements against one physical
unit, because financing the same car twice is one of the oldest frauds there is.
Instalments, schedules and total cost of credit come from `instalment_cents()`
and `generate_payment_schedule()` in Postgres, so what the customer is told they
owe and what the system chases are the same numbers.

**Payments.** xCentral does not collect money — BipraPay and xPayments do, and
post each collection here. What this schema owns is the comparison: what was
due, what arrived, and what the gap says. A debit order that presents and
bounces is recorded as a *reversal*, not as a payment that never happened,
because the money not being there on the day is the signal that matters.
Allocation is oldest-instalment-first, so "three months in arrears" means one
thing consistently.

**Background vetting.** Addresses normalise to a canonical fingerprint, which is
what makes "one address serving nine unrelated applicants" a query. Phones carry
RICA registration and, more importantly, **SIM-swap recency** — control of the
number is what one-time passwords rest on, and a swap days before an application
is a takeover pattern. Employment checks the employer at CIPC and does the
payslip arithmetic: a forger who edits the gross rarely recomputes the
deductions.

**Credit capacity.** `assess_credit_capacity()` answers "how much can this
person be given" from four inputs, and the weakest governs. Affordability is a
**ceiling, not an average** — no score creates money that is not there, and
lending past it is reckless credit under NCA s80. A bureau score describes how
they paid everyone else; payment behaviour here describes how they paid *us*,
and can substitute for a thin file up to the policy's uplift. An open critical
fraud signal stops the assessment entirely rather than producing a number from
data that may be fabricated.

**Fraud.** Most application fraud is not clever: the same document under two
names, a shared address or bank account, a payslip that does not reconcile, a
recent SIM swap, a car already financed. Every rule is a query over data the hub
holds, stored as a row with its threshold and weight, and every signal carries
the evidence. A critical signal raises an alert for a person — it does not
auto-decline, because a shared address is a block of flats as often as a
syndicate. Confirming fraud writes the identifiers to a register so the same
entity is caught on sight next time.

## Live capture and onboarding

A wizard that runs the counter flow: scan the identity document, photograph the
person in front of you, capture a fingerprint, match the two faces, and put it
to the agents.

**What is computed in the browser, from the actual pixels** (`src/capture.js`):

| Metric | How |
|---|---|
| Sharpness | Variance of the Laplacian — a blurred image has little high-frequency content |
| Brightness | Mean luminance, 0-100 |
| Contrast | Standard deviation of luminance; a photo of a screen reads low |
| Faces | Shape Detection API where the browser has it |
| Motion | Inter-frame difference across a short burst — a held-up photograph barely changes |

Quality is assessed **before** anything is templated or matched, and a capture
below the bar is refused with a remedy an operator can act on ("move somewhere
brighter") rather than a code. Most failed matches are failed photographs, and
telling someone "no match" when the answer is "too dark" produces the wrong
action.

A browser without the Shape Detection API produces an **advisory**, not a
failure — it lowers confidence and is recorded, but never blocks. A capability
gap in the browser is not a defect in the photograph.

**Fingerprints, honestly.** A browser cannot read a fingerprint scanner.
WebAuthn asks the *device* to verify its owner with its own sensor and returns a
signed assertion. The template never leaves the secure element — neither the
page nor the hub ever sees it. So this proves *the enrolled owner of that device
was present*, not that a particular person's finger was. AFIS-grade capture
needs a scanner SDK behind the provider interface. The distinction is preserved
in the schema, the API responses and the UI copy.

**Face matching** is a provider call. Comparing two faces needs a model trained
for it; this module's job is to make sure what it sends is worth comparing.

## The agents

Six agents plus an orchestrator. Each owns one question, forms its own verdict
from the check data the pipeline produced, writes its rationale in plain words,
and some can veto.

| Agent | Question | Veto |
|---|---|---|
| Identity | Is the identity well-formed, real, alive, and not on a list? | yes |
| Document | Is the document genuine, current, and does it belong to this person? | yes |
| Biometric | Is the person at the camera the person on the document, and were they present? | yes |
| Fraud | Does anything here link to a pattern we have seen before? | yes |
| Affordability | Can this person carry what they are asking for, under the NCA? | no |
| Compliance | Is there lawful basis for everything we have done? | yes |

**These are deterministic reasoners, not language models.** Every shipped agent
applies a stated policy to stored data, and the `reasoning` column records which
kind each is — so a model-backed agent added later is a visible change, asserted
by a test. That is deliberate: a lending decision has to be reproducible and
explainable to the NCR, and "the model said so" is neither.

The orchestrator **arbitrates rather than averages**. A veto is decisive;
averaging a failed identity check against a good affordability score would
produce a number that means nothing. Three or more abstentions is a *refer*, not
an approval — six agents that mostly had nothing to read is a thin file.

A recommendation is never applied automatically. A person accepts or overrides
it, and the override is recorded against their account with a reason.

## Layout

```
supabase/
  migrations/     schema, RLS, and the arithmetic that must not drift
  functions/
    _shared/      http, hash, auth, cases, mrz, providers
    verify-identity  verify-document  verify-credit  verify-biometric
    customer-onboard vet-background   assess-credit-capacity
    manage-contract  record-payment   run-fraud-screen
    capture-intake   agent-adjudicate
    platform-verify  the machine-to-machine endpoint siblings call
    case-decision    record-consent   manage-api-key  document-access
    webhook-dispatch retention-purge
  tests/          harness.sql + logic_tests.sql
  seed.sql        sandbox data, including the sibling platforms
  seed_lifecycle.sql  customers, assets, agreements, payments, fraud fixtures
  seed_demo.sql   the demonstration cohort — 24 people, 32 cases, 20 agreements
src/              supabaseClient.js, backend.js (window.XC_DB), console.js
                  capture.js — camera, image quality, liveness, WebAuthn
tests/            browser tests for the capture maths and the wizard
index.html        the console
```

---

## Running it

```bash
npm install
npm run dev
```

Point it at a Supabase project:

```bash
VITE_SUPABASE_URL_SANDBOX=https://<project>.supabase.co
VITE_SUPABASE_KEY_SANDBOX=sb_publishable_…
```

Both are publishable values and public by design — access control is row level
security and the edge functions, not secrecy. Without them the console still
loads and says what is missing rather than rendering blank.

Apply the schema:

```bash
supabase db push
psql "$DATABASE_URL" -f supabase/seed.sql
```

### Loading the demonstration data

`seed.sql` alone is enough to prove the schema works, not enough to show
anyone. For a populated console — every page with something on it — load all
three seeds in order:

```bash
DATABASE_URL="postgresql://postgres:…@db.<project>.supabase.co:5432/postgres" \
  ./scripts/seed-demo.sh
```

That gives 24 subjects across 32 cases at every status, 21 customers, 20
agreements with 260 payments and a live arrears book, 12 capture sessions with
their agent adjudications, five fraud alerts from critical down to medium, 220
API calls, 302 audit entries and seven data subject requests.

Everyone in it is invented. The arithmetic is not: every case score,
instalment, arrears position, behaviour rating, fraud score and credit limit on
those rows is what `case_score()`, `instalment_cents()`, `allocate_payment()`,
`recompute_contract_position()`, `payment_behaviour()`, `run_fraud_screen()` and
`assess_credit_capacity()` actually computed from the evidence. Change a row and
the numbers move, which is the only reason a demo of this is worth giving.

The seeds insert rather than upsert, so run them once against an empty schema
and use `supabase db reset` to start over.

Function secrets:

| Secret | Purpose |
|---|---|
| `ID_HASH_PEPPER` | **Required.** Identity hashing refuses to run without it |
| `WEBHOOK_DISPATCH_SECRET` | Authenticates the scheduled webhook dispatcher |
| `RETENTION_PURGE_SECRET` | Authenticates the scheduled purge |
| `XCENTRAL_PROVIDER_<DOMAIN>` | Provider per domain; defaults to `simulation` |
| `XCENTRAL_ALLOW_SIMULATION_IN_PROD` | Only to deliberately drill against production |

## Tests

```bash
# Schema and the arithmetic — 154 assertions across three suites
createdb xctest
psql -d xctest -v ON_ERROR_STOP=1 -f supabase/tests/harness.sql
for f in supabase/migrations/*.sql; do psql -d xctest -v ON_ERROR_STOP=1 -f "$f"; done
psql -d xctest -v ON_ERROR_STOP=1 -f supabase/tests/logic_tests.sql
psql -d xctest -v ON_ERROR_STOP=1 -f supabase/tests/lifecycle_tests.sql
psql -d xctest -v ON_ERROR_STOP=1 -f supabase/tests/capture_tests.sql

# MRZ, against the ICAO 9303 specimen documents
node --experimental-strip-types supabase/functions/_shared/mrz.test.ts

# Image-quality maths, in a real browser against synthetic images
node tests/run-capture-metrics.mjs

# The whole capture wizard, driven by Chromium's synthetic camera
npm run build && node tests/run-onboarding-wizard.mjs
```

`harness.sql` recreates just enough of a Supabase project (`auth.users`,
`storage.buckets`, the `anon`/`authenticated`/`service_role` roles) for the
migrations to run against stock Postgres. It is not deployed.

---

## Calling the hub

```http
POST /functions/v1/platform-verify
x-api-key: xc_live_…
x-idempotency-key: onboard-MRC-APP-0022

{
  "idNumber": "9001015009086",
  "firstNames": "Thabo", "surname": "Mokoena",
  "level": "standard",
  "purpose": "onboarding",
  "clientReference": "MRC-APP-0022",
  "consent": { "granted": true, "textId": "ct_identity_v1", "method": "click_wrap" }
}
```

Returns a case id and a status. A case needing a person comes back as `review`;
the platform is notified by webhook when it is decided rather than polling.
Webhooks are signed over the timestamp **and** the body
(`X-XCentral-Signature: v1=<hmac>`), so a captured delivery cannot be replayed
indefinitely — receivers should reject a stale `X-XCentral-Timestamp`.

Two things this endpoint will not do: run a check the key's scopes do not cover
(it returns 403 naming the refused domains rather than silently skipping them),
and process anything without a consent record attributing responsibility to the
calling platform.

### Assurance levels

Defined as rows in `verification_requirements`, so the definition is something
an auditor can read rather than logic buried in a function.

- **basic** — ID structure, deceased register, watchlist screening
- **standard** — the above plus authority lookup, document authenticity, expiry, name match
- **enhanced** — the above plus face match and liveness; credit optional

A required check that has not run holds the case at `in_progress` however high
the average is. A failed required check rejects the case whatever the average
is. The score never outvotes a definite result.

---

## Roles

`super_admin`, `verification_officer`, `compliance_officer`, `credit_analyst`,
`biometrics_officer`, `fraud_analyst`, `collections`, `dealer_admin`,
`developer`, `support`, `read_only`. New staff default to
`read_only` until a Super Admin assigns a real role.

Permissions are checked by `has_permission()` — the same function the RLS
policies use — so the console and the database cannot disagree about what a role
allows.
