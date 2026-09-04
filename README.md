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

**Requires an authority we do not have offline.** These run through the
provider adapters in `_shared/providers.ts`:

| Check | Real provider would be |
|---|---|
| Does Home Affairs hold this record | DHA / HANIS |
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

## Layout

```
supabase/
  migrations/     schema, RLS, and the arithmetic that must not drift
  functions/
    _shared/      http, hash, auth, cases, mrz, providers
    verify-identity  verify-document  verify-credit  verify-biometric
    platform-verify  the machine-to-machine endpoint siblings call
    case-decision    record-consent   manage-api-key  document-access
    webhook-dispatch retention-purge
  tests/          harness.sql + logic_tests.sql
  seed.sql        sandbox data, including the sibling platforms
src/              supabaseClient.js, backend.js (window.XC_DB), console.js
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
# Schema and the arithmetic — 63 assertions
createdb xctest
psql -d xctest -v ON_ERROR_STOP=1 -f supabase/tests/harness.sql
for f in supabase/migrations/*.sql; do psql -d xctest -v ON_ERROR_STOP=1 -f "$f"; done
psql -d xctest -v ON_ERROR_STOP=1 -f supabase/tests/logic_tests.sql

# MRZ, against the ICAO 9303 specimen documents
node --experimental-strip-types supabase/functions/_shared/mrz.test.ts
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
`biometrics_officer`, `developer`, `support`, `read_only`. New staff default to
`read_only` until a Super Admin assigns a real role.

Permissions are checked by `has_permission()` — the same function the RLS
policies use — so the console and the database cannot disagree about what a role
allows.
