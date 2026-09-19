-- ══════════════════════════════════════════════════════════════
-- Scanning an uploaded document: was it altered, was it ever genuine,
-- and has it been seen before.
--
-- Three questions, because they need different evidence and lead to
-- different conversations with the applicant. A system that asks only
-- the first catches only the laziest of the three frauds.
--
--   Altered      Somebody took a real document and changed it. The
--                page looks right; the file does not. A PDF saved a
--                second time keeps the first version inside it, the
--                editing software writes its name into the metadata,
--                and a number typed over an existing page rarely
--                lands in the same font as the ones beside it.
--   Counterfeit  Nobody altered anything, because nobody started from
--                a real document. The giveaway is ARITHMETIC: a
--                payroll system cannot emit a payslip where gross less
--                deductions is not net, and a person building one in a
--                spreadsheet very often can.
--   Duplicate    It is real and unaltered and belongs to somebody
--                else. Caught by fingerprint, three ways: the same
--                file, the same picture re-saved, the same content
--                re-exported.
--
-- The reading happens in the browser — src/vision/scan.js and
-- src/vision/pdf.js — because the file is there and sending it
-- somewhere is a decision nobody asked for. What lives here is the
-- judgement: which findings count, how much, and what they add up to.
-- ══════════════════════════════════════════════════════════════

create table public.document_scan_rules (
  code text primary key,
  -- Which of the three questions this finding answers. Kept because a
  -- score of 62 says nothing useful, and "altered, and here is the
  -- page's previous wording" says everything.
  question text not null check (question in ('altered', 'counterfeit', 'duplicate')),
  name text not null,
  weight int not null check (weight between 0 and 100),
  severity text not null check (severity in ('warn', 'critical')),
  -- Decisive means the finding settles the question on its own. Only
  -- two qualify, and both are cases where the document contradicts
  -- ITSELF rather than merely looking unusual: arithmetic that does
  -- not balance, and an earlier version of the page still inside the
  -- file saying something different.
  decisive boolean not null default false,
  active boolean not null default true
);

alter table public.document_scan_rules enable row level security;
create policy "document_scan_rules_select_authenticated"
  on public.document_scan_rules for select to authenticated using (true);

insert into public.document_scan_rules (code, question, name, weight, severity, decisive) values
  ('pdf_saved_more_than_once',        'altered',     'Saved more than once',                   16, 'warn',     false),
  ('pdf_modified_after_creation',     'altered',     'Modified after it was created',          18, 'warn',     false),
  ('pdf_producer_is_image_editor',    'altered',     'Produced by an image editor',            34, 'critical', false),
  ('pdf_producer_is_word_processor',  'altered',     'Produced by a word processor',           20, 'warn',     false),
  ('pdf_metadata_stripped',           'altered',     'Metadata removed',                       14, 'warn',     false),
  ('pdf_edit_history_present',        'altered',     'Carries an editing history',             24, 'critical', false),
  ('pdf_figure_in_a_foreign_font',    'altered',     'A figure set in a foreign font',         32, 'critical', false),
  ('pdf_previous_version_differs',    'altered',     'An earlier version said something else', 60, 'critical', true),
  ('image_region_edited',             'altered',     'A region of the page was edited',        30, 'critical', false),
  ('arithmetic_does_not_reconcile',   'counterfeit', 'The document does not add up',           55, 'critical', true),
  ('pdf_is_a_picture_in_a_wrapper',   'counterfeit', 'A picture in a PDF wrapper',             22, 'warn',     false),
  ('layout_matches_no_known_issuer',  'counterfeit', 'Matches no known issuer template',       18, 'warn',     false),
  ('document_already_on_file',        'duplicate',   'Already on file',                        12, 'warn',     false),
  ('document_reused_across_identities', 'duplicate', 'The same document under two identities', 45, 'critical', false);

-- The score, and the breakdown by question. One number alone loses the
-- distinction between a document that was edited and one that was
-- never real, and those call for different questions at the counter.
create or replace function public.score_document_scan(p_codes text[])
returns jsonb
language sql stable as $$
  with hit as (
    select r.* from public.document_scan_rules r
    where r.active and r.code = any(coalesce(p_codes, '{}'::text[]))
  ),
  agg as (
    select
      coalesce(sum(weight), 0)::int as deduction,
      coalesce(bool_or(decisive), false) as decisive,
      count(*) filter (where severity = 'critical')::int as critical_count
    from hit
  )
  select jsonb_build_object(
    'score', greatest(0, least(100, 100 - a.deduction)),
    'status', case
      when a.decisive or 100 - a.deduction < 45 then 'failed'
      when 100 - a.deduction < 78 then 'manual_review'
      else 'passed' end,
    'decisive', a.decisive,
    'critical_count', a.critical_count,
    'altered', (select coalesce(jsonb_agg(code order by weight desc), '[]'::jsonb) from hit where question = 'altered'),
    'counterfeit', (select coalesce(jsonb_agg(code order by weight desc), '[]'::jsonb) from hit where question = 'counterfeit'),
    'duplicate', (select coalesce(jsonb_agg(code order by weight desc), '[]'::jsonb) from hit where question = 'duplicate')
  )
  from agg a;
$$;

comment on function public.score_document_scan is
  'Turns the findings of a document scan into a score, a status, and a breakdown by question. '
  'Mirrors scoreScan() in src/localPipeline.js; the two are checked against each other so the '
  'console and the pipeline cannot drift apart about what a document is worth.';

-- Fingerprints belong with the forensics, and duplicate detection is
-- only as good as what it can be compared against. The perceptual hash
-- column already exists; these two are what catch a document that was
-- re-saved or re-exported rather than re-sent.
alter table public.document_forensics
  add column if not exists content_fingerprint jsonb,
  add column if not exists layout_fingerprint jsonb,
  add column if not exists revisions int,
  add column if not exists has_text_layer boolean;

comment on column public.document_forensics.content_fingerprint is
  'MinHash signature over four-word shingles of the text layer. Catches the same statement '
  're-exported by different software, where neither the bytes nor the picture match.';
comment on column public.document_forensics.revisions is
  'How many times the file has been saved. A document generated once and left alone has one; '
  'every later save appends a new body and keeps the old one.';
