-- ══════════════════════════════════════════════════════════════
-- Document forensics: what each document is expected to carry, and
-- what it costs when a portrait does not belong to the card it is on.
--
-- Photograph substitution is the oldest document fraud there is: take
-- a real card belonging to somebody else and put your own photograph
-- in place of theirs. It survives a human glance and it survives a
-- face match, because the face on the card really is the face of the
-- person holding it. What catches it is the card: a portrait printed
-- as part of a document and a portrait stuck on top of one are
-- physically different objects, and they disagree about noise, focus,
-- white point, compression and whether there is an edge.
--
-- Both tables are configuration rather than code for the usual reason
-- — thresholds and weights get tuned, and a decision made last March
-- has to stay explicable against the weights that were in force in
-- March. The browser carries the same rows in src/data/reference.js;
-- these are what the project gets when it is stood up.
--
-- I am NOT CERTAIN the feature expectations match every issued version
-- of every South African document. Card designs change and I have no
-- specimen to check against. That is precisely why they are rows.
-- ══════════════════════════════════════════════════════════════

create table public.document_security_features (
  doc_type text primary key references public.document_types(id) on delete cascade,
  id1_geometry boolean not null default false,
  mrz boolean not null default false,
  ghost_portrait boolean not null default false,
  laser_engraved boolean not null default false,
  barcode boolean not null default false,
  notes text
);

alter table public.document_security_features enable row level security;
create policy "document_security_features_select_authenticated"
  on public.document_security_features for select to authenticated using (true);

insert into public.document_security_features
  (doc_type, id1_geometry, mrz, ghost_portrait, laser_engraved, barcode, notes) values
  ('sa_id_card', true, true, true, true, false,
   'Polycarbonate card, laser engraved, secondary ghost portrait, machine-readable zone on the reverse.'),
  -- The portrait in a green book is affixed and laminated rather than
  -- printed into the substrate, which is why substitution is easier
  -- here and the boundary checks carry more of the weight.
  ('sa_id_book', false, false, false, false, true,
   'Green barcoded book. The portrait is affixed and laminated.'),
  ('passport', false, true, true, false, false,
   'ICAO 9303 booklet. Two machine-readable lines of 44 characters on the data page.'),
  ('drivers_licence', true, false, false, false, true,
   'ID-1 card with a PDF417 barcode. No machine-readable zone.'),
  ('asylum_permit', false, false, false, false, true,
   'Paper permit. Few physical security features, so the identity checks carry more of the weight.');

create table public.document_forensic_rules (
  code text primary key,
  name text not null,
  weight int not null check (weight between 0 and 100),
  severity text not null check (severity in ('warn', 'critical')),
  -- Decisive means the finding settles the question on its own.
  -- Exactly one rule qualifies, and it is the only one here that is
  -- arithmetic rather than inference: a machine-readable zone whose
  -- check digits fail is a document that does not agree with itself.
  -- Everything else is a reason to look.
  decisive boolean not null default false,
  active boolean not null default true
);

alter table public.document_forensic_rules enable row level security;
create policy "document_forensic_rules_select_authenticated"
  on public.document_forensic_rules for select to authenticated using (true);

insert into public.document_forensic_rules (code, name, weight, severity, decisive) values
  ('doc_geometry_wrong',            'Card is not the standard shape',              12, 'warn',     false),
  ('doc_photographed_from_screen',  'Photographed from a screen',                  12, 'warn',     false),
  ('doc_mrz_band_missing',          'No machine-readable band where one belongs',  14, 'warn',     false),
  ('doc_mrz_check_digit_failed',    'Machine-readable zone fails its check digits', 45, 'critical', true),
  ('portrait_not_found',            'No portrait on the document',                 20, 'warn',     false),
  ('portrait_noise_mismatch',       'Portrait texture does not match the card',    22, 'critical', false),
  ('portrait_focus_mismatch',       'Portrait is in a different focal plane',      18, 'warn',     false),
  ('portrait_colour_mismatch',      'Portrait and card disagree on white',         16, 'warn',     false),
  ('portrait_edge_step',            'Portrait has a physical edge',                24, 'critical', false),
  ('portrait_taped_or_glossy',      'Tape or gloss over the portrait',             20, 'critical', false),
  ('portrait_error_level_mismatch', 'Portrait compresses unlike the card',         18, 'warn',     false),
  ('ghost_portrait_mismatch',       'Ghost portrait is a different face',          40, 'critical', false),
  ('ghost_portrait_absent',         'Ghost portrait missing',                      10, 'warn',     false);

-- The authenticity score, from whichever rules fired. Kept here rather
-- than in the application so the console and the pipeline cannot drift
-- apart about what a document is worth.
create or replace function public.score_document_forensics(p_codes text[])
returns table (score int, status text, decisive boolean, critical_count int)
language sql stable as $$
  with hit as (
    select r.* from public.document_forensic_rules r
    where r.active and r.code = any(coalesce(p_codes, '{}'::text[]))
  ),
  agg as (
    select
      coalesce(sum(weight), 0)::int as deduction,
      coalesce(bool_or(decisive), false) as decisive,
      count(*) filter (where severity = 'critical')::int as critical_count
    from hit
  )
  select
    greatest(0, least(100, 100 - deduction))::int,
    case
      when decisive or 100 - deduction < 45 then 'failed'
      when 100 - deduction < 78 then 'manual_review'
      else 'passed'
    end,
    decisive,
    critical_count
  from agg;
$$;

comment on function public.score_document_forensics is
  'Turns the forensic findings on a document into a score and a status. '
  'Nothing here is decisive except a machine-readable zone failing its check digits: '
  'every other finding has an innocent explanation, which is why they refer rather than refuse.';
