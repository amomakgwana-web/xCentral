-- ══════════════════════════════════════════════════════════════
-- Document verification.
--
-- Documents are the most sensitive artefact the hub holds: an ID card
-- scan carries far more personal information than the fields we
-- actually need from it. Three rules follow from that and are
-- enforced structurally, not by convention:
--
--   1. The image never lands in a public bucket. Storage is private
--      and reachable only through signed URLs minted by an edge
--      function after a permission check.
--   2. Every document carries a retention_until date from the moment
--      it is stored, so POPIA minimisation is a scheduled job rather
--      than an intention.
--   3. The extracted fields — not the image — are what downstream
--      checks read. A passing document check does not require anyone
--      to reopen the scan.
-- ══════════════════════════════════════════════════════════════

-- ── Accepted document types ─────────────────────────────════════
create table public.document_types (
  id text primary key,
  name text not null,
  category text not null check (category in ('identity','address','income','business','other')),
  -- Documents that prove a current state go stale; an ID card does not.
  max_age_days int,
  -- Whether the type is expected to carry a machine-readable zone.
  has_mrz boolean not null default false,
  -- Whether the type carries a portrait usable for biometric comparison.
  has_portrait boolean not null default false,
  active boolean not null default true
);

alter table public.document_types enable row level security;

create policy "document_types_select_authenticated" on public.document_types
  for select to authenticated using (true);

insert into public.document_types (id, name, category, max_age_days, has_mrz, has_portrait) values
  ('sa_id_card',       'SA Smart ID Card',            'identity', null, true,  true),
  ('sa_id_book',       'SA Green Barcoded ID Book',   'identity', null, false, true),
  ('passport',         'Passport',                    'identity', null, true,  true),
  ('drivers_licence',  'SA Driving Licence Card',     'identity', null, false, true),
  ('asylum_permit',    'Asylum Seeker / Refugee Permit','identity', null, false, true),
  ('proof_of_address', 'Proof of Address',            'address',  90,   false, false),
  ('bank_statement',   'Bank Statement',              'income',   90,   false, false),
  ('payslip',          'Payslip',                     'income',   90,   false, false),
  ('cipc_registration','CIPC Company Registration',   'business', null, false, false),
  ('sars_tax_clearance','SARS Tax Clearance / PIN',   'business', 365,  false, false),
  ('selfie',           'Liveness Selfie',             'other',    null, false, true);

-- ── Stored documents ────────────────────────────────────────────
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  case_id text references public.verification_cases(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete restrict,
  doc_type text not null references public.document_types(id),
  -- Path inside the private 'verification-documents' bucket.
  storage_path text not null,
  mime_type text,
  size_bytes int,
  page_count int default 1,
  -- Content hash. Identical re-uploads are detectable, and a document
  -- can be proven unaltered since the moment it was verified.
  sha256 text not null,
  uploaded_by uuid references public.profiles(id),
  uploaded_via text not null default 'console' check (uploaded_via in ('console','api','portal')),
  -- POPIA retention. Set at insert; the purge job deletes the object
  -- and blanks storage_path once passed.
  retention_until timestamptz not null default (now() + interval '5 years'),
  purged_at timestamptz,
  created_at timestamptz not null default now()
);

create index documents_case_idx on public.documents (case_id);
create index documents_sha_idx on public.documents (sha256);
create index documents_retention_idx on public.documents (retention_until) where purged_at is null;

alter table public.documents enable row level security;

create policy "documents_select_authenticated" on public.documents
  for select to authenticated using (true);

-- ── Document verification results ───────────────────────────────
create table public.document_verifications (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references public.verification_cases(id) on delete cascade,
  check_id uuid references public.verification_checks(id) on delete set null,
  document_id uuid not null references public.documents(id) on delete cascade,
  doc_type text not null references public.document_types(id),
  -- Machine-readable zone: parsed and each ICAO 9303 check digit verified.
  mrz_present boolean not null default false,
  mrz_valid boolean,
  mrz_fields jsonb not null default '{}',
  -- Fields lifted off the document face (OCR or MRZ), normalised.
  extracted jsonb not null default '{}',
  -- Document dates, pulled forward for indexable expiry logic.
  document_number_last4 text,
  date_of_issue date,
  date_of_expiry date,
  expired boolean,
  stale boolean,
  -- Authenticity signals. Each entry is {code, severity, detail}; the
  -- score is what the case reads.
  authenticity_score numeric(5,2) check (authenticity_score between 0 and 100),
  tamper_signals jsonb not null default '[]',
  provider text not null default 'simulation',
  status text not null default 'pending'
    check (status in ('pending','passed','failed','manual_review','error')),
  reason_codes text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index document_verifications_case_idx on public.document_verifications (case_id);
create index document_verifications_doc_idx on public.document_verifications (document_id);

alter table public.document_verifications enable row level security;

create policy "document_verifications_select_authenticated" on public.document_verifications
  for select to authenticated using (true);

-- ── Private storage for document images ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'verification-documents',
  'verification-documents',
  false,
  15728640, -- 15 MB
  array['image/jpeg','image/png','image/webp','image/heic','application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No select/insert/update/delete policy for `authenticated` is granted
-- on this bucket. Staff reach a document only through the
-- document-access edge function, which checks has_permission('documents')
-- and writes an audit_log entry before minting a short-lived signed URL.
-- The service role bypasses RLS, so the edge functions still work.
create policy "verification_documents_no_direct_client_access"
  on storage.objects for select to authenticated
  using (bucket_id <> 'verification-documents');
