-- ══════════════════════════════════════════════════════════════
-- Demonstration seed.
--
-- Runs third, after seed.sql and seed_lifecycle.sql. Those two exist
-- to prove the schema works; this one exists so the console has enough
-- in it to walk a client through, page by page, without any screen
-- reading as an empty table.
--
-- Every person, company, vehicle, account number and phone number here
-- is invented. The names are drawn from South Africa's actual language
-- groups and the addresses from real suburbs because a demo that shows
-- "Test User 1" of "123 Main Street" teaches a client nothing about
-- whether the system would work for them — but no row corresponds to a
-- real individual, and none is intended to.
--
-- What is NOT invented is the arithmetic. Every score, instalment,
-- arrears position, behaviour rating, fraud score and capacity limit on
-- these rows is computed by the same functions that would run in
-- production — case_score(), instalment_cents(), allocate_payment(),
-- recompute_contract_position(), payment_behaviour(), run_fraud_screen()
-- and assess_credit_capacity(). Nothing below hard-codes an outcome it
-- has not earned, which is why the numbers hold together when a client
-- clicks into them.
-- ══════════════════════════════════════════════════════════════

-- ── A deterministic descriptor generator ────────────────────────
-- Biometric templates are 128 (face) or 96 (fingerprint) floats. For a
-- demo they must not be random: the live capture has to sit close to
-- the document portrait for a genuine applicant and far from it for an
-- impostor, or the match scores on screen mean nothing.
--
-- base(seed) is a fixed pseudo-random vector per person. Adding
-- p_noise × a second vector walks away from it by a controlled amount,
-- so cosine_similarity() lands where the scenario needs it:
--   0.35 → ~0.95   a clean re-capture of the same face
--   0.55 → ~0.89   a normal live capture
--   1.10 → ~0.73   borderline, at the strict threshold
--   2.50 → ~0.48   a different person
-- pg_temp means it disappears with the session rather than shipping.
create or replace function pg_temp.demo_descriptor(
  p_seed int, p_dim int, p_noise numeric default 0
) returns real[]
language sql
immutable
as $$
  select array_agg(
    ((sin(i * 12.9898 + p_seed) * 43758.5453
       - floor(sin(i * 12.9898 + p_seed) * 43758.5453)) - 0.5
     + p_noise *
     ((sin(i * 78.233 + p_seed) * 12345.6789
       - floor(sin(i * 78.233 + p_seed) * 12345.6789)) - 0.5)
    )::real order by i)
  from generate_series(1, p_dim) i;
$$;

-- ══════════════════════════════════════════════════════════════
-- 1 · The cohort
--
-- Held in temporary tables rather than written out as one 60-column
-- insert, so a reader can see each person's identity, their contact
-- and employment picture, their bureau record and their agreement side
-- by side. The loops further down turn these into real rows.
-- ══════════════════════════════════════════════════════════════

create temporary table demo_person (
  key            text primary key,
  first_names    text,
  surname        text,
  gender         text,
  dob            date,
  citizenship    text,
  -- Last four of the SA ID. The third-from-last digit is the
  -- citizenship digit — 0 for a citizen, 1 for a permanent resident —
  -- so these are consistent with the citizenship column beside them.
  id_last4       text,
  platform       text,
  cust_no        text,
  cust_status    text,
  email          text,
  contact        text,
  onboard_months int,
  case_id        text,
  client_ref     text,
  purpose        text,
  level          text,
  case_status    text,
  risk           text,
  arc            text,
  decision_note  text
);

insert into demo_person values
  ('sipho','Sipho','Ndlovu','male','1986-04-12','citizen','7085',
   'biprapay','BP-CUST-1002','active','sipho.ndlovu@example.co.za','whatsapp',22,
   'VC-2026-000005','MRC-APP-0031','onboarding','standard','verified','low','clean_a',null),

  ('zanele','Zanele','Mthembu','female','1993-09-30','citizen','3084',
   'biprapay','BP-CUST-1003','active','z.mthembu@example.co.za','sms',11,
   'VC-2026-000006','MRC-APP-0044','lending','enhanced','verified','low','clean_b',null),

  ('johan','Johan','Botha','male','1975-02-18','citizen','5083',
   'biprapay','BP-CUST-1004','active','johan.botha@example.co.za','email',18,
   'VC-2026-000007','MRC-APP-0051','lending','enhanced','verified','low','clean_a',null),

  ('aisha','Aisha','Patel','female','1991-11-05','citizen','1086',
   'xpayments','XP-CUST-2045','active','aisha.patel@example.co.za','whatsapp',9,
   'VC-2026-000008','LOAN-2026-0502','lending','enhanced','verified','low','clean_b',null),

  -- Referred by the agents on a thin bureau file, then approved by a
  -- credit officer seven months ago. The engine still suggests 'review';
  -- the decision_reason is the record of the person who overrode it, and
  -- the arrears on his contract are the reason that override is worth
  -- showing a client rather than hiding.
  ('tebogo','Tebogo','Seleka','male','1998-06-14','citizen','8081',
   'xpayments','XP-CUST-2046','active','t.seleka@example.co.za','sms',7,
   'VC-2026-000009','LOAN-2026-0518','lending','enhanced','verified','medium','thin_credit',
   'Referred on a thin bureau file. Approved by the credit officer on a larger deposit '
   || 'and a 12-month employment confirmation from the employer directly.'),

  -- Approved by a person against the engine's own suggestion of 'review'.
  -- case_score() still says review; the decision_reason is what makes the
  -- override auditable rather than invisible.
  ('chantal','Chantal','Arendse','female','1983-03-08','citizen','2087',
   'xpayments','XP-CUST-2047','active','c.arendse@example.co.za','phone',16,
   'VC-2026-000010','LOAN-2026-0533','lending','enhanced','verified','medium','marginal',
   'Affordability margin accepted by the credit committee: 16 years at the same employer, '
   || 'a R2 750 deposit, and the instalment is R340 below the applicant''s current rent.'),

  ('mandla','Mandla','Zwane','male','1979-12-01','citizen','6089',
   'veribills','VB-CUST-0318','active','mandla.zwane@example.co.za','sms',9,
   'VC-2026-000011','ACC-90114','onboarding','standard','verified','low','clean_a',null),

  ('precious','Precious','Maluleke','female','1996-08-22','citizen','4082',
   'veribills','VB-CUST-0319','active','p.maluleke@example.co.za','whatsapp',5,
   'VC-2026-000012','ACC-90228','onboarding','standard','verified','medium','marginal',null),

  ('riaan','Riaan','du Plessis','male','1988-05-19','citizen','9088',
   'biprapay','BP-CUST-1005','active','riaan.dup@example.co.za','email',39,
   'VC-2026-000013','MRC-APP-0018','onboarding','standard','verified','low','clean_a',null),

  ('nokuthula','Nokuthula','Ngcobo','female','1990-02-27','citizen','3089',
   'xpayments','XP-CUST-2048','active','n.ngcobo@example.co.za','whatsapp',13,
   'VC-2026-000014','LOAN-2026-0401','lending','enhanced','verified','low','clean_b',null),

  ('kagiso','Kagiso','Moloi','male','2001-10-11','citizen','5086',
   'piggybag','PG-CUST-3011','active','kagiso.moloi@example.co.za','whatsapp',6,
   'VC-2026-000015','PB-APP-7741','lending','standard','verified','medium','thin_credit',null),

  ('fatima','Fatima','Khan','female','1994-07-03','citizen','7083',
   'xpayments','XP-CUST-2049','active','fatima.khan@example.co.za','email',4,
   'VC-2026-000016','LOAN-2026-0549','lending','enhanced','review','medium','thin_credit',null),

  ('lwazi','Lwazi','Gumede','male','1992-01-25','citizen','2085',
   'biprapay','BP-CUST-1006','suspended','l.gumede@example.co.za','sms',3,
   'VC-2026-000017','MRC-APP-0067','lending','enhanced','rejected','high','fraud',
   'Payslip does not reconcile; banking details shared with an unrelated identity'),

  ('anele','Anele','Dube','female','1987-04-16','citizen','8087',
   'veribills','VB-CUST-0320','active','anele.dube@example.co.za','sms',12,
   'VC-2026-000018','ACC-90341','onboarding','standard','verified','low','clean_a',null),

  ('pieters','Pieter','Swanepoel','male','1971-09-09','citizen','4089',
   'biprapay','BP-CUST-1007','active','p.swanepoel@example.co.za','phone',20,
   'VC-2026-000019','MRC-APP-0072','lending','enhanced','verified','low','clean_a',null),

  ('thandeka','Thandeka','Sibiya','female','1999-03-21','permanent_resident','6183',
   'piggybag','PG-CUST-3012','onboarding','t.sibiya@example.co.za','whatsapp',0,
   'VC-2026-000020','PB-APP-7802','onboarding','standard','in_progress','low','in_progress',null),

  ('bongani','Bongani','Mahlangu','male','1984-11-30','citizen','1082',
   'mysmme','SM-CUST-4007','active','b.mahlangu@example.co.za','email',10,
   'VC-2026-000021','SM-ONB-1140','onboarding','standard','verified','low','clean_b',null),

  ('rethabile','Rethabile','Mokoena','female','1989-06-07','citizen','3086',
   'xpayments','XP-CUST-2050','dormant','r.mokoena@example.co.za','sms',41,
   'VC-2026-000022','LOAN-2025-0912','lending','enhanced','verified','low','clean_a',null),

  -- Two applicants who never became customers, so the cases list shows
  -- what a declined file looks like.
  ('gerhard','Gerhard','Venter','male','1968-08-14','citizen','5089',
   'veribills',null,null,null,null,null,
   'VC-2026-000023','ACC-90402','onboarding','enhanced','review','high','watchlist',null),

  ('sibusiso','Sibusiso','Khoza','male','1981-07-19','citizen','9081',
   'biprapay',null,null,null,null,null,
   'VC-2026-000024','MRC-APP-0080','onboarding','standard','rejected','high','deceased',
   'Identity number appears on the Home Affairs deceased register');

-- ── Address, phone, employment and banking ──────────────────────
create temporary table demo_contact (
  key          text primary key,
  line1        text, suburb text, city text, province text, postcode text,
  years_there  numeric,
  msisdn       text, network text, line_type text,
  rica_status  text, rica_name text, rica_match int, tenure_days int,
  employer     text, cipc_reg text, cipc_status text, sector text,
  job_title    text, emp_type text, emp_years numeric,
  gross_cents  bigint, net_cents bigint,
  bank         text, branch text, acct_type text, acct_last4 text,
  holder       text, avs_status text
);

insert into demo_contact values
  ('sipho','24 Ncamu Street','Orlando East','Soweto','Gauteng','1804',7.5,
   '+27833410992','MTN','mobile_contract','registered_to_subject','Sipho Ndlovu',100,2740,
   'Randfontein Logistics (Pty) Ltd','2009/114882/07','in_business','Transport',
   'Fleet Controller','permanent',6.5,5150000,3890000,
   'Standard Bank','051001','cheque','2214','S Ndlovu','verified'),

  ('zanele','Unit 14, Villa Rosa, 8 Rabie Street','Fontainebleau','Randburg','Gauteng','2194',2.5,
   '+27716620481','Vodacom','mobile_contract','registered_to_subject','Zanele Mthembu',100,980,
   'Meridian Health Administrators (Pty) Ltd','2014/220913/07','in_business','Healthcare',
   'Claims Assessor','permanent',4.0,3860000,2940000,
   'Capitec','470010','savings','7731','Z Mthembu','verified'),

  ('johan','12 Olienhout Avenue','Eldoraigne','Centurion','Gauteng','0157',14.0,
   '+27824407719','Vodacom','mobile_contract','registered_to_subject','J Botha',92,4890,
   'Botha & Seuns Boerdery CC','1998/031104/23','in_business','Agriculture',
   'Owner','self_employed',14.0,9800000,7420000,
   'Absa','632005','cheque','5508','J Botha','verified'),

  ('aisha','9 Sunbird Close','Parklands','Cape Town','Western Cape','7441',5.0,
   '+27607781204','Telkom','mobile_contract','registered_to_subject','Aisha Patel',100,1830,
   'Cape Peninsula Dental Group Inc','2007/009911/21','in_business','Healthcare',
   'Practice Manager','permanent',5.5,4720000,3560000,
   'Nedbank','198765','cheque','6642','A Patel','verified'),

  ('tebogo','Room 208, Nkosi Residence, 41 Church Street','Sunnyside','Pretoria','Gauteng','0002',1.5,
   '+27655590037','Cell C','mobile_contract','registered_to_subject','T Seleka',88,410,
   'Tshwane Retail Solutions (Pty) Ltd','2019/447120/07','in_business','Retail',
   'Assistant Store Manager','permanent',1.5,2410000,1980000,
   'TymeBank','678910','savings','1093','T Seleka','verified'),

  ('chantal','7 Duiker Road','Bothasig','Cape Town','Western Cape','7441',9.0,
   '+27738820156','MTN','mobile_contract','registered_to_subject','C Arendse',94,3260,
   'Atlantic Seaboard Catering CC','2012/118804/23','in_business','Hospitality',
   'Operations Coordinator','permanent',6.0,2960000,2410000,
   'Absa','632005','savings','3389','C Arendse','verified'),

  ('mandla','118 Mangosuthu Highway','Umlazi K','Durban','KwaZulu-Natal','4031',11.0,
   '+27786641903','Vodacom','mobile_contract','registered_to_subject','Mandla Zwane',100,3980,
   'eThekwini Steel Fabricators (Pty) Ltd','2003/017740/07','in_business','Manufacturing',
   'Workshop Foreman','permanent',9.0,4310000,3320000,
   'FNB','250655','cheque','8817','M Zwane','verified'),

  ('precious','Stand 4471, Extension 12','Tembisa','Kempton Park','Gauteng','1632',3.0,
   '+27713307744','MTN','mobile_prepaid','registered_to_other','N Maluleke',45,620,
   'Highveld Cleaning Services CC','2016/302217/23','in_business','Services',
   'Team Leader','contract',2.0,1840000,1620000,
   'Capitec','470010','savings','4402','P Maluleke','verified'),

  ('riaan','31 Bosbok Street','Van Riebeeck Park','Kempton Park','Gauteng','1619',12.0,
   '+27829913066','Vodacom','mobile_contract','registered_to_subject','R du Plessis',97,5120,
   'Aeroline Ground Handling (Pty) Ltd','2001/004417/07','in_business','Aviation',
   'Maintenance Planner','permanent',11.0,6740000,5010000,
   'Standard Bank','051001','cheque','9930','R du Plessis','verified'),

  ('nokuthula','46 Peace Road','Chatsworth Unit 3','Durban','KwaZulu-Natal','4092',6.0,
   '+27842218870','Vodacom','mobile_contract','registered_to_subject','N Ngcobo',100,2210,
   'KZN Provincial Education Department','1994/000114/30','in_business','Education',
   'Deputy Principal','permanent',13.0,5880000,4290000,
   'Nedbank','198765','cheque','7714','N Ngcobo','verified'),

  ('kagiso','142 Hans van Rensburg Street','Polokwane Central','Polokwane','Limpopo','0699',1.0,
   '+27671140258','Rain','mobile_prepaid','registered_to_subject','K Moloi',90,19,
   'Limpopo Fresh Produce Market (Pty) Ltd','2018/551002/07','in_business','Agriculture',
   'Junior Buyer','permanent',1.0,2180000,1870000,
   'TymeBank','678910','savings','2266','K Moloi','verified'),

  ('fatima','Unit 6, Rosebank Mews, 22 Sturdee Avenue','Rosebank','Johannesburg','Gauteng','2196',1.5,
   '+27794406617','MTN','mobile_contract','registered_to_subject','F Khan',100,540,
   'Meridian Health Administrators (Pty) Ltd','2014/220913/07','in_business','Healthcare',
   'Actuarial Analyst','permanent',1.5,6200000,4480000,
   'Investec','580105','cheque','5571','F Khan','verified'),

  -- The fraud file. The bank account and the address are shared with
  -- other identities, the employer is not at CIPC, and the payslip does
  -- not reconcile. Every one of those is a rule the engine already has.
  ('lwazi','9 Kerk Straat','Central','Bloemfontein','Free State','9301',0.3,
   '+27723334455','Cell C','mobile_prepaid','registered_to_other','M Nkosi',12,58,
   'Sentinel Holdings Group',null,'not_found',null,
   'Business Development Executive','permanent',0.2,8800000,8200000,
   'FNB','250655','cheque','1188','M Nkosi','name_mismatch'),

  ('anele','203 Buffelsdoorn Avenue','Rocklands','Mitchells Plain','Western Cape','7785',8.0,
   '+27825571340','Vodacom','mobile_contract','registered_to_subject','A Dube',100,2960,
   'Western Cape Textile Mills (Pty) Ltd','2005/119440/07','in_business','Manufacturing',
   'Quality Inspector','permanent',7.0,2740000,2280000,
   'Absa','632005','savings','6093','A Dube','verified'),

  ('pieters','Plot 44, Rietvlei Road','Bapsfontein','Ekurhuleni','Gauteng','1510',22.0,
   '+27827740119','MTN','mobile_contract','registered_to_subject','P J Swanepoel',95,7840,
   'Swanepoel Grondwerke CC','1996/022714/23','in_business','Construction',
   'Member','self_employed',22.0,8600000,6510000,
   'Standard Bank','051001','cheque','4417','P J Swanepoel','verified'),

  ('thandeka','Block C, Room 11, Turfloop Student Village','Mankweng','Polokwane','Limpopo','0727',0.5,
   '+27618802237','Cell C','mobile_prepaid','registered_to_subject','T Sibiya',93,180,
   'Mankweng Campus Bookstore CC','2021/610044/23','in_business','Retail',
   'Sales Assistant','informal',0.5,940000,880000,
   'Capitec','470010','savings','8830','T Sibiya','verified'),

  ('bongani','88 Mandela Drive','KaNyamazane','Mbombela','Mpumalanga','1214',9.0,
   '+27764430098','MTN','mobile_contract','registered_to_subject','B Mahlangu',100,3140,
   'Mahlangu Electrical & Solar CC','2015/440118/23','in_business','Construction',
   'Member','self_employed',9.0,5400000,4360000,
   'FNB','250655','cheque','2201','B Mahlangu','verified'),

  ('rethabile','17 Kobus Street','Bayswater','Bloemfontein','Free State','9301',10.0,
   '+27837714402','Vodacom','mobile_contract','registered_to_subject','R Mokoena',100,3650,
   'Free State Legal Aid Board','1997/000221/30','in_business','Legal',
   'Paralegal','permanent',10.0,3420000,2740000,
   'Nedbank','198765','cheque','9945','R Mokoena','verified'),

  ('gerhard','5 Voortrekker Street','Bethlehem Central','Bethlehem','Free State','9700',18.0,
   '+27823317790','Vodacom','mobile_contract','registered_to_subject','G Venter',100,6210,
   'Thabo Mofutsanyana District Municipality','1996/000440/30','in_business','Government',
   'Supply Chain Manager','permanent',12.0,7200000,5340000,
   'Absa','632005','cheque','3302','G Venter','verified'),

  ('sibusiso','62 Sixth Avenue','Alexandra','Johannesburg','Gauteng','2090',4.0,
   '+27731120884','Cell C','mobile_prepaid','registered_to_other','Unknown',0,95,
   'Not supplied',null,'not_found',null,
   'Not supplied','permanent',0,0,0,
   'Standard Bank','051001','savings','0071','S Khoza','unavailable');

-- ── Bureau records ──────────────────────────────────────────────
create temporary table demo_credit (
  key            text primary key,
  bureau         text,
  score          int,
  band           text,
  risk           text,
  accounts       int,
  arrears_accts  int,
  worst_arrears  int,
  obligations    bigint,
  defaults       int,
  judgments      int,
  debt_review    boolean,
  enquiry        text
);

insert into demo_credit values
  ('sipho',    'transunion_za',708,'Good',     'low',    5,0,0, 486000,0,0,false,'hard'),
  ('zanele',   'transunion_za',664,'Favourable','low',   3,0,0, 312000,0,0,false,'hard'),
  ('johan',    'experian_za',  781,'Excellent','low',    7,0,0, 918000,0,0,false,'hard'),
  ('aisha',    'transunion_za',735,'Good',     'low',    4,0,0, 402000,0,0,false,'hard'),
  ('tebogo',   'xds',          591,'Average',  'medium', 1,0,0,  89000,0,0,false,'hard'),
  ('chantal',  'transunion_za',612,'Average',  'medium', 6,1,2, 674000,1,0,false,'hard'),
  ('mandla',   'experian_za',  699,'Good',     'low',    4,0,0, 358000,0,0,false,'hard'),
  ('precious', 'xds',          574,'Below average','medium',2,1,1, 141000,0,0,false,'hard'),
  ('riaan',    'transunion_za',764,'Excellent','low',    6,0,0, 214000,0,0,false,'soft'),
  ('nokuthula','experian_za',  722,'Good',     'low',    5,0,0, 561000,0,0,false,'hard'),
  ('kagiso',   'vericred',     548,'Below average','medium',1,0,0, 42000,0,0,false,'hard'),
  ('fatima',   'transunion_za',603,'Average',  'medium', 2,0,0, 128000,0,0,false,'hard'),
  ('lwazi',    'xds',          509,'Poor',     'high',   9,4,5,1240000,3,1,false,'hard'),
  ('anele',    'experian_za',  681,'Good',     'low',    3,0,0, 176000,0,0,false,'hard'),
  ('pieters',  'transunion_za',752,'Excellent','low',    8,0,0, 803000,0,0,false,'hard'),
  ('bongani',  'transunion_za',689,'Good',     'low',    4,0,0, 447000,0,0,false,'hard'),
  ('rethabile','experian_za',  717,'Good',     'low',    3,0,0,      0,0,0,false,'soft'),
  ('gerhard',  'transunion_za',742,'Good',     'low',    6,0,0, 692000,0,0,false,'hard');

-- ── Assets and agreements ───────────────────────────────────────
-- pattern drives how the payment history is generated further down:
--   clean    every instalment, on the due date
--   late     every instalment, but 9 to 17 days after it was due
--   slipping on time until the last two, which were never paid
--   arrears  on time until the last three, which were never paid
--   default  one payment, then nothing
--   nothing  a first-payment default: not a cent
--   settled  the full term paid out
create temporary table demo_finance (
  key          text primary key,
  contract_id  text,
  agreement    text,
  asset_type   text,
  make text, model text, variant text, yr int, colour text,
  vin text, engine_no text, reg_no text, imei text, serial_no text,
  retail_cents bigint, trade_cents bigint, odo int, condition text,
  -- registry is what the asset register said. 'clear' and 'encumbered' come
  -- from NaTIS for a vehicle. A handset gets 'unavailable', not 'not_found':
  -- there is no IMEI registry integration, so no answer was obtained — and
  -- asset_registry_adverse treats 'not_found' as adverse, which for a phone
  -- would flag every honest customer who financed one.
  registry text,
  principal    bigint,
  deposit      bigint,
  rate         numeric,
  term         int,
  months_ago   int,
  pay_day      int,
  collection   text,
  pattern      text
);

insert into demo_finance values
  ('sipho','CT-BIPR-2024-00021','instalment_sale','vehicle_passenger',
   'Toyota','Corolla Cross','1.8 XS Hybrid',2024,'Silver Metallic',
   'AHTKB3CD10A114772','2ZRA114772','CA 214-887',null,null,
   45990000,39100000,41200,'used','clear',
   41390000,4600000,12.50,72,22,1,'debicheck','clean'),

  ('zanele','CT-BIPR-2025-00034','instalment_sale','vehicle_passenger',
   'Volkswagen','Polo','1.0 TSI Life',2024,'Reef Blue',
   'AAVZZZ6RZRU203118','CHZ203118','JH 88 KP GP',null,null,
   37990000,33800000,26400,'used','clear',
   34190000,3800000,14.25,72,11,28,'debit_order','late'),

  ('johan','CT-BIPR-2024-00047','instalment_sale','vehicle_commercial',
   'Ford','Ranger','2.0 SiT Double Cab XL',2025,'Arctic White',
   'AFAPXXMRJPRJ40912','YNWTRJ40912','FB 71 DN GP',null,null,
   57990000,51200000,33800,'used','clear',
   46390000,11600000,11.75,60,18,25,'debicheck','clean'),

  ('aisha','CT-XPAY-2025-00028','instalment_sale','vehicle_passenger',
   'Suzuki','Swift','1.2 GL AMT',2025,'Burning Red',
   'MA3EYD81SNA771204','K12MN771204','CJ 90 442',null,null,
   22990000,20800000,14900,'used','clear',
   20690000,2300000,13.00,60,9,1,'debit_order','clean'),

  ('tebogo','CT-XPAY-2025-00041','instalment_sale','vehicle_passenger',
   'Kia','Sonet','1.5 EX Auto',2024,'Gravity Grey',
   'MZBBB81CDRC330817','D4FAC330817','TS 44 RB GP',null,null,
   36990000,32100000,22700,'used','clear',
   35140000,1850000,17.50,72,7,30,'debit_order','slipping'),

  ('chantal','CT-XPAY-2024-00016','instalment_sale','vehicle_passenger',
   'Hyundai','Grand i10','1.0 Motion',2023,'Polar White',
   'MALA851CBPM662043','G3LAM662043','CY 118-004',null,null,
   24990000,20400000,58300,'used','clear',
   24990000,0,18.25,72,16,15,'debit_order','arrears'),

  ('mandla','CT-VERI-2025-00019','phone_contract','handset',
   'Samsung','Galaxy A16 5G',null,2025,'Blue Black',
   null,null,null,'352098001234564',null,
   499900,null,null,'new','unavailable',
   499900,0,22.00,24,9,1,'debit_order','clean'),

  ('precious','CT-VERI-2026-00007','phone_contract','handset',
   'Apple','iPhone 15','128 GB',2025,'Black',
   null,null,null,'358765098877448',null,
   1899900,null,null,'new','unavailable',
   1899900,0,24.50,24,5,1,'debit_order','default'),

  ('riaan','CT-BIPR-2023-00009','instalment_sale','vehicle_commercial',
   'Isuzu','D-Max','250 HO Hi-Ride Double Cab',2021,'Obsidian Grey',
   'ADMTFS85JM7114093','4JJ1TC114093','JR 55 PL GP',null,null,
   38900000,29700000,118400,'used','clear',
   30000000,6000000,12.00,36,39,25,'debicheck','settled'),

  ('nokuthula','CT-XPAY-2025-00011','instalment_sale','vehicle_commercial',
   'Nissan','NP200','1.6i Safety Pack',2024,'White',
   'ADNUD22S6RW118826','K4MUD118826','ND 664-129',null,null,
   24990000,21600000,37100,'used','clear',
   22490000,2500000,13.75,60,13,25,'debit_order','clean'),

  ('kagiso','CT-PIGG-2026-00003','instalment_sale','vehicle_passenger',
   'Renault','Kwid','1.0 Zen',2025,'Ice Blue',
   'MEEBBA00XRB440271','B4DAB440271','LP 22 704',null,null,
   19990000,17400000,9800,'used','clear',
   18990000,1000000,19.50,72,6,5,'debit_order','late'),

  ('fatima','CT-XPAY-2026-00019','instalment_sale','vehicle_passenger',
   'Haval','Jolion','1.5T City DCT',2025,'Ayers Grey',
   'LGWFF4A55RH881420','GW4B15881420','JK 12 MN GP',null,null,
   37990000,34200000,7400,'used','clear',
   33190000,4800000,14.75,72,4,1,'debicheck','clean'),

  ('lwazi','CT-BIPR-2026-00052','instalment_sale','vehicle_passenger',
   'Chery','Tiggo 4 Pro','1.5 Comfort',2025,'Carbon Black',
   'LVVDB11B9RD770338','SQRE4T15770338','FS 90 118',null,null,
   32990000,29100000,2100,'used','clear',
   32990000,0,21.00,72,3,1,'debit_order','nothing'),

  ('anele','CT-VERI-2025-00008','phone_contract','handset',
   'Xiaomi','Redmi Note 14','256 GB',2025,'Midnight Black',
   null,null,null,'353411120099116',null,
   549900,null,null,'new','unavailable',
   549900,0,22.00,24,12,15,'debit_order','clean'),

  ('pieters','CT-BIPR-2024-00033','instalment_sale','vehicle_commercial',
   'Mahindra','Pik Up','2.2 mHawk S6 Double Cab',2025,'Napoli Black',
   'MA1TA2MRKR2G14806','MHAWK2G14806','GP 44 SW GP',null,null,
   45990000,40100000,29600,'used','clear',
   36790000,9200000,12.25,60,20,25,'debicheck','clean'),

  ('bongani','CT-SMME-2025-00004','instalment_sale','solar_system',
   'Sunsynk','5kW Hybrid Inverter','with 5.12 kWh Hubble AM-2',2025,null,
   null,null,null,null,'SS5K-2025-114882',
   8900000,null,null,'new','unavailable',
   8900000,0,16.00,48,10,1,'debit_order','clean'),

  ('rethabile','CT-XPAY-2022-00004','instalment_sale','vehicle_passenger',
   'Honda','Amaze','1.2 Comfort CVT',2020,'Lunar Silver',
   'MAKGM6650LN114427','L12B1114427','FS 71 220',null,null,
   16990000,12400000,96200,'used','clear',
   16000000,2000000,13.50,36,40,1,'debit_order','settled');

-- ── Check templates, one set per outcome ────────────────────────
-- The scores here are the evidence; case_score() turns them into the
-- case score at the end of this file. The statuses beside each case in
-- demo_person are the human decision that followed.
create temporary table demo_arc_check (
  arc text, domain text, check_type text, provider text,
  status text, score numeric, result jsonb, reason_codes text[]
);

insert into demo_arc_check values
  -- A clean identity-and-document file.
  ('clean_a','identity','id_structure',         'xcentral',  'passed',100,'{"luhn_valid":true}','{}'),
  ('clean_a','identity','authority_lookup',     'simulation','passed',100,'{"authority_status":"match","name_match_score":100}','{}'),
  ('clean_a','identity','deceased_register',    'xcentral',  'passed',100,'{"on_register":false}','{}'),
  ('clean_a','identity','watchlist_screening',  'xcentral',  'passed',100,'{"hits":[]}','{}'),
  ('clean_a','document','document_authenticity','simulation','passed', 96,'{"mrz_valid":true,"tamper_signals":[]}','{}'),
  ('clean_a','document','document_expiry',      'xcentral',  'passed',100,'{"expired":false}','{}'),
  ('clean_a','document','name_match',           'xcentral',  'passed',100,'{"method":"exact"}','{}'),
  ('clean_a','biometric','face_match',          'simulation','passed', 94,'{"similarity":0.89,"threshold":0.68}','{}'),
  ('clean_a','biometric','liveness',            'simulation','passed', 97,'{"attack_type":"none","pad_level":2}','{}'),

  -- The same, carried through to a credit decision.
  ('clean_b','identity','id_structure',         'xcentral',  'passed',100,'{"luhn_valid":true}','{}'),
  ('clean_b','identity','authority_lookup',     'simulation','passed',100,'{"authority_status":"match"}','{}'),
  ('clean_b','identity','deceased_register',    'xcentral',  'passed',100,'{"on_register":false}','{}'),
  ('clean_b','identity','watchlist_screening',  'xcentral',  'passed',100,'{"hits":[]}','{}'),
  ('clean_b','document','document_authenticity','simulation','passed', 91,'{"mrz_valid":true}','{}'),
  ('clean_b','document','document_expiry',      'xcentral',  'passed',100,'{"expired":false}','{}'),
  ('clean_b','document','name_match',           'xcentral',  'passed', 98,'{"method":"token_set"}','{}'),
  ('clean_b','biometric','face_match',          'simulation','passed', 90,'{"similarity":0.84,"threshold":0.68}','{}'),
  ('clean_b','biometric','liveness',            'simulation','passed', 95,'{"attack_type":"none","pad_level":2}','{}'),
  ('clean_b','credit', 'bureau_enquiry',        'simulation','passed', 82,'{"enquiry":"hard"}','{}'),
  ('clean_b','credit', 'affordability',         'xcentral',  'passed', 88,'{"outcome":"affordable"}','{}'),

  -- Everything checks out except the bureau, which has barely seen them.
  ('thin_credit','identity','id_structure',         'xcentral',  'passed',100,'{}','{}'),
  ('thin_credit','identity','authority_lookup',     'simulation','passed',100,'{"authority_status":"match"}','{}'),
  ('thin_credit','identity','deceased_register',    'xcentral',  'passed',100,'{"on_register":false}','{}'),
  ('thin_credit','identity','watchlist_screening',  'xcentral',  'passed',100,'{"hits":[]}','{}'),
  ('thin_credit','document','document_authenticity','simulation','passed', 89,'{"mrz_valid":true}','{}'),
  ('thin_credit','document','document_expiry',      'xcentral',  'passed',100,'{"expired":false}','{}'),
  ('thin_credit','document','name_match',           'xcentral',  'passed', 96,'{}','{}'),
  ('thin_credit','biometric','face_match',          'simulation','passed', 88,'{"similarity":0.81}','{}'),
  ('thin_credit','biometric','liveness',            'simulation','passed', 94,'{"attack_type":"none"}','{}'),
  ('thin_credit','credit','bureau_enquiry',         'simulation','manual_review',44,'{"accounts_total":1}',array['thin_credit_file']),
  ('thin_credit','credit','affordability',          'xcentral',  'passed', 74,'{"outcome":"affordable"}','{}'),

  -- Affordable, but only just.
  ('marginal','identity','id_structure',         'xcentral',  'passed',100,'{}','{}'),
  ('marginal','identity','authority_lookup',     'simulation','passed',100,'{"authority_status":"match"}','{}'),
  ('marginal','identity','deceased_register',    'xcentral',  'passed',100,'{"on_register":false}','{}'),
  ('marginal','identity','watchlist_screening',  'xcentral',  'passed',100,'{"hits":[]}','{}'),
  ('marginal','document','document_authenticity','simulation','passed', 87,'{"mrz_valid":true}','{}'),
  ('marginal','document','document_expiry',      'xcentral',  'passed',100,'{"expired":false}','{}'),
  ('marginal','document','name_match',           'xcentral',  'passed', 93,'{}','{}'),
  ('marginal','biometric','face_match',          'simulation','passed', 86,'{"similarity":0.78}','{}'),
  ('marginal','biometric','liveness',            'simulation','passed', 92,'{"attack_type":"none"}','{}'),
  ('marginal','credit','bureau_enquiry',         'simulation','passed', 61,'{"defaults":1}','{}'),
  ('marginal','credit','affordability',          'xcentral',  'manual_review',58,'{"outcome":"marginal"}',array['thin_affordability_margin']),

  -- The one that should never have got through, and did not.
  ('fraud','identity','id_structure',         'xcentral',  'passed',100,'{}','{}'),
  ('fraud','identity','authority_lookup',     'simulation','passed',100,'{"authority_status":"match"}','{}'),
  ('fraud','identity','deceased_register',    'xcentral',  'passed',100,'{"on_register":false}','{}'),
  ('fraud','identity','watchlist_screening',  'xcentral',  'passed',100,'{"hits":[]}','{}'),
  ('fraud','document','document_authenticity','simulation','failed',   4,'{"mrz_valid":false,"tamper_signals":[{"code":"font_mismatch","severity":"critical"},{"code":"metadata_edited","severity":"critical"}]}',
     array['mrz_check_digit_failed_composite','tamper_font_mismatch','tamper_metadata_edited']),
  ('fraud','document','document_expiry',      'xcentral',  'passed',100,'{"expired":false}','{}'),
  ('fraud','document','name_match',           'xcentral',  'manual_review',61,'{"document_name":"L Gumede","claimed_name":"Lwazi Gumede"}',
     array['name_partial_match']),
  ('fraud','biometric','face_match',          'simulation','failed',  18,'{"similarity":0.48,"threshold":0.68}',array['face_below_threshold']),
  ('fraud','biometric','liveness',            'simulation','passed',  91,'{"attack_type":"none"}','{}'),
  ('fraud','credit','bureau_enquiry',         'simulation','passed',  31,'{"defaults":3,"judgments":1}','{}'),
  ('fraud','credit','affordability',          'xcentral',  'failed',   9,'{"outcome":"not_affordable"}',
     array['payslip_net_does_not_reconcile','employer_not_at_cipc']),

  -- A name that resembles one on a list, pending adjudication.
  ('watchlist','identity','id_structure',         'xcentral',  'passed',100,'{}','{}'),
  ('watchlist','identity','authority_lookup',     'simulation','passed',100,'{"authority_status":"match"}','{}'),
  ('watchlist','identity','deceased_register',    'xcentral',  'passed',100,'{"on_register":false}','{}'),
  ('watchlist','identity','watchlist_screening',  'xcentral',  'manual_review',40,'{"hits":[{"list":"Domestic PEP Register","score":88}]}',
     array['watchlist_potential_match']),
  ('watchlist','document','document_authenticity','simulation','passed', 95,'{"mrz_valid":true}','{}'),
  ('watchlist','document','document_expiry',      'xcentral',  'passed',100,'{"expired":false}','{}'),
  ('watchlist','document','name_match',           'xcentral',  'passed', 99,'{}','{}'),
  ('watchlist','biometric','face_match',          'simulation','passed', 93,'{"similarity":0.87}','{}'),
  ('watchlist','biometric','liveness',            'simulation','passed', 96,'{"attack_type":"none"}','{}'),

  -- An identity number that belongs to someone who has died.
  ('deceased','identity','id_structure',         'xcentral',  'passed',100,'{}','{}'),
  ('deceased','identity','authority_lookup',     'simulation','manual_review',45,
     '{"authority_status":"match","record_state":"closed","deceased_flag":true}',
     array['authority_record_marked_deceased']),
  ('deceased','identity','deceased_register',    'xcentral',  'failed',  0,'{"on_register":true,"date_of_death":"2025-03-19"}',
     array['subject_on_deceased_register']),
  ('deceased','identity','watchlist_screening',  'xcentral',  'passed',100,'{"hits":[]}','{}'),
  ('deceased','document','document_authenticity','simulation','passed', 90,'{"mrz_valid":true}','{}'),
  ('deceased','document','document_expiry',      'xcentral',  'passed',100,'{"expired":false}','{}'),
  ('deceased','document','name_match',           'xcentral',  'passed', 97,'{}','{}'),

  -- Still being worked: the identity is confirmed, the document is with an
  -- examiner, and the rest has not been run. case_score() reports what has
  -- been checked so far and names what is still missing.
  ('in_progress','identity','id_structure',         'xcentral',  'passed',100,'{}','{}'),
  ('in_progress','identity','deceased_register',    'xcentral',  'passed',100,'{"on_register":false}','{}'),
  ('in_progress','document','document_authenticity','simulation','manual_review',52,
     '{"mrz_valid":true,"tamper_signals":[{"code":"glare_over_portrait","severity":"warn"}]}',
     array['image_quality_marginal']),

  -- A periodic FICA refresh: identity only, no new documents.
  ('refresh','identity','id_structure',        'xcentral',  'passed',100,'{}','{}'),
  ('refresh','identity','authority_lookup',    'simulation','passed',100,'{"authority_status":"match"}','{}'),
  ('refresh','identity','deceased_register',   'xcentral',  'passed',100,'{"on_register":false}','{}'),
  ('refresh','identity','watchlist_screening', 'xcentral',  'passed',100,'{"hits":[]}','{}'),

  -- Age gate: nothing more is collected than the question needs.
  ('agecheck','identity','id_structure',       'xcentral','passed',100,'{"derived_age":24,"over_18":true}','{}'),
  ('agecheck','identity','deceased_register',  'xcentral','passed',100,'{"on_register":false}','{}'),
  ('agecheck','identity','watchlist_screening','xcentral','passed',100,'{"hits":[]}','{}'),
  ('agecheck','document','document_expiry',    'xcentral','passed',100,'{"expired":false}','{}');

-- ══════════════════════════════════════════════════════════════
-- 2 · Reference data the demo needs on top of the base seed
-- ══════════════════════════════════════════════════════════════

-- More names on the screening lists, so a search returns something.
insert into public.watchlist_entries (list_name, entry_type, full_name, aliases, country, notes) values
  ('Domestic PEP Register','pep','Gerhardus Venter',       array['G. Venter','Gerhard Venter'],'ZA','Municipal supply chain — illustrative'),
  ('Domestic PEP Register','pep','Thulani Radebe',         array['T. Radebe'],                 'ZA','Provincial legislature — illustrative'),
  ('Domestic PEP Register','pep','Marietjie van Wyk',      array['M. van Wyk'],                'ZA','State-owned entity board — illustrative'),
  ('Foreign PEP Register', 'pep','Emmanuel Okonkwo',       array['E. Okonkwo'],                'NG','Foreign official — illustrative'),
  ('UNSC Consolidated','sanction','Dmitri Sokolov',        array['D. Sokolov'],                'RU','Illustrative entry'),
  ('UNSC Consolidated','sanction','Hassan al-Rashid',      array['H. al-Rashid','Hasan Rashid'],'SY','Illustrative entry'),
  ('FIC Targeted Sanctions','sanction','Bright Star Trading CC', array[]::text[],              'ZA','Illustrative entry'),
  ('Adverse Media','adverse_media','Kwenzokuhle Ndaba',    array['K. Ndaba'],                  'ZA','Illustrative entry'),
  ('Internal Deny List','internal_deny','Sentinel Holdings Group', array['Sentinel Holdings'], 'ZA','Employer used on three fraudulent files — illustrative')
on conflict do nothing;

insert into public.deceased_register (id_hash, date_of_death, source) values
  ('seed-subject-sibusiso', '2025-03-19', 'dha_feed'),
  ('seed-deceased-0000000000000000000000000000000000000000000000000000003', '2025-08-04', 'dha_feed'),
  ('seed-deceased-0000000000000000000000000000000000000000000000000000004', '2026-01-22', 'dha_feed')
on conflict (id_hash) do nothing;

-- API keys, so the platforms page is not a single row. The hashes are
-- of strings nobody holds; these keys cannot authenticate anything.
insert into public.api_keys (platform_id, name, key_prefix, key_last4, key_hash,
                             environment, scopes, rate_limit_per_min, last_used_at, expires_at)
values
  ('biprapay','Onboarding — production worker','xck_live_bp','4f21',
   encode(digest('demo-not-a-real-key-biprapay-1','sha256'),'hex'),
   'sandbox', array['identity','document','biometric'], 240, now() - interval '11 minutes', now() + interval '9 months'),
  ('biprapay','Batch KYC refresh','xck_live_bp','9c07',
   encode(digest('demo-not-a-real-key-biprapay-2','sha256'),'hex'),
   'sandbox', array['identity'], 60, now() - interval '3 days', now() + interval '9 months'),
  ('xpayments','Lending origination','xck_live_xp','1d88',
   encode(digest('demo-not-a-real-key-xpayments-1','sha256'),'hex'),
   'sandbox', array['identity','document','credit','biometric'], 300, now() - interval '4 minutes', now() + interval '6 months'),
  ('xpayments','Collections read-only','xck_live_xp','7b30',
   encode(digest('demo-not-a-real-key-xpayments-2','sha256'),'hex'),
   'sandbox', array['identity'], 120, now() - interval '2 hours', now() + interval '6 months'),
  ('veribills','Account opening','xck_live_vb','5a94',
   encode(digest('demo-not-a-real-key-veribills-1','sha256'),'hex'),
   'sandbox', array['identity','document'], 120, now() - interval '27 minutes', now() + interval '12 months'),
  ('piggybag','Age gate','xck_live_pb','2e63',
   encode(digest('demo-not-a-real-key-piggybag-1','sha256'),'hex'),
   'sandbox', array['identity'], 600, now() - interval '1 hour', now() + interval '12 months'),
  ('mysmme','SMME onboarding','xck_live_sm','8f45',
   encode(digest('demo-not-a-real-key-mysmme-1','sha256'),'hex'),
   'sandbox', array['identity','document'], 60, now() - interval '6 days', now() + interval '12 months')
on conflict do nothing;

-- One revoked key, because a client always asks what happens then.
insert into public.api_keys (platform_id, name, key_prefix, key_last4, key_hash,
                             environment, scopes, rate_limit_per_min, revoked_at, created_at)
values
  ('biprapay','Legacy integration (rotated out)','xck_live_bp','0a19',
   encode(digest('demo-not-a-real-key-biprapay-legacy','sha256'),'hex'),
   'sandbox', array['identity','document'], 60,
   now() - interval '5 weeks', now() - interval '14 months')
on conflict do nothing;

insert into public.webhook_endpoints (platform_id, url, secret, events) values
  ('veribills','https://veribills.co.za/hooks/xcentral','seed-secret-replace-me-veribills', array['case.decided','fraud.alert']),
  ('piggybag', 'https://piggybag.co.za/api/xcentral',   'seed-secret-replace-me-piggybag',  array['case.decided'])
on conflict do nothing;

-- ══════════════════════════════════════════════════════════════
-- 3 · Subjects, consents, customers, contact and employment
-- ══════════════════════════════════════════════════════════════

do $$
declare
  p record;
  c record;
  v_subject uuid;
  v_customer uuid;
  v_employer uuid;
  v_addr uuid;
  v_phone uuid;
  v_emp uuid;
begin
  for p in select * from demo_person order by key loop
    select * into c from demo_contact where key = p.key;

    insert into public.subjects (id_type, id_hash, id_last4, first_names, surname,
                                 date_of_birth, gender, citizenship,
                                 assurance_level, assurance_expires_at)
    values ('sa_id', 'seed-subject-' || p.key, p.id_last4, p.first_names, p.surname,
            p.dob, p.gender, p.citizenship,
            case p.case_status when 'verified' then 'standard'
                               when 'review' then 'basic'
                               else 'none' end,
            case when p.case_status = 'verified'
                 then now() + interval '12 months' - make_interval(months => p.onboard_months)
                 else null end)
    returning id into v_subject;

    -- ── Consent first, always ──────────────────────────────────
    -- The credit and biometric triggers refuse the rows below without
    -- it, which is the point: the demo cannot be made to skip consent
    -- even by seeding around it.
    insert into public.consents (subject_id, platform_id, purpose, lawful_basis,
                                 consent_text_id, method, granted_at)
    values
      (v_subject, p.platform, 'identity_verification', 'consent', 'ct_identity_v1', 'click_wrap',
       now() - make_interval(months => greatest(p.onboard_months, 0))),
      (v_subject, p.platform, 'watchlist_screening',   'legal_obligation', 'ct_screening_v1', 'click_wrap',
       now() - make_interval(months => greatest(p.onboard_months, 0))),
      (v_subject, p.platform, 'result_sharing',        'consent', 'ct_sharing_v1', 'click_wrap',
       now() - make_interval(months => greatest(p.onboard_months, 0)));

    if p.arc <> 'in_progress' then
      insert into public.consents (subject_id, platform_id, purpose, lawful_basis,
                                   consent_text_id, method, granted_at)
      values (v_subject, p.platform, 'document_storage', 'legal_obligation', 'ct_document_v1', 'click_wrap',
              now() - make_interval(months => greatest(p.onboard_months, 0)));
    end if;

    if p.arc in ('clean_a','clean_b','thin_credit','marginal','fraud','watchlist') then
      insert into public.consents (subject_id, platform_id, purpose, lawful_basis,
                                   consent_text_id, method, granted_at)
      values (v_subject, p.platform, 'biometric_processing', 'consent', 'ct_biometric_v1', 'click_wrap',
              now() - make_interval(months => greatest(p.onboard_months, 0)));
    end if;

    if exists (select 1 from demo_credit where key = p.key) then
      insert into public.consents (subject_id, platform_id, purpose, lawful_basis,
                                   consent_text_id, method, granted_at)
      values (v_subject, p.platform, 'credit_enquiry', 'consent', 'ct_credit_v1',
              case when p.platform = 'biprapay' then 'signed_document' else 'click_wrap' end,
              now() - make_interval(months => greatest(p.onboard_months, 0)));
    end if;

    -- ── The case, and the evidence behind it ───────────────────
    -- Created here rather than later because the customer record, the
    -- address verification and the phone verification all reference it.
    insert into public.verification_cases (id, subject_id, platform_id, client_reference,
      purpose, level, status, risk, score, decision_reason, decided_at, expires_at, created_at)
    values (p.case_id, v_subject, p.platform, p.client_ref, p.purpose, p.level,
            p.case_status, p.risk, 0, p.decision_note,
            case when p.case_status in ('verified','rejected')
                 then now() - make_interval(months => greatest(p.onboard_months, 0)) + interval '4 hours' end,
            case when p.case_status = 'verified'
                 then now() + interval '12 months' - make_interval(months => greatest(p.onboard_months, 0)) end,
            now() - make_interval(months => greatest(p.onboard_months, 0)));

    insert into public.verification_checks (case_id, domain, check_type, provider,
                                            status, score, result, reason_codes, created_at)
    select p.case_id, a.domain, a.check_type, a.provider, a.status, a.score,
           a.result, a.reason_codes,
           now() - make_interval(months => greatest(p.onboard_months, 0)) + interval '3 hours'
    from demo_arc_check a where a.arc = p.arc;

    -- ── The customer record, where there is one ────────────────
    if p.cust_no is not null then
      insert into public.customers (subject_id, platform_id, customer_number, status,
                                    onboarding_case_id, onboarded_at, email, preferred_contact)
      values (v_subject, p.platform, p.cust_no, p.cust_status, p.case_id,
              now() - make_interval(months => p.onboard_months), p.email, p.contact)
      returning id into v_customer;
    else
      v_customer := null;
    end if;

    -- ── Address ────────────────────────────────────────────────
    insert into public.addresses (customer_id, subject_id, address_type, line1, suburb,
                                  city, province, postal_code, resident_since, address_hash)
    values (v_customer, v_subject, 'residential', c.line1, c.suburb, c.city, c.province,
            c.postcode, (current_date - (c.years_there * 365)::int), 'pending')
    returning id into v_addr;

    insert into public.address_verifications (address_id, case_id, method,
      document_in_subject_name, document_date, status, confidence, provider)
    values (v_addr, p.case_id,
            case when c.years_there >= 3 then 'municipal_account' else 'bank_statement' end,
            c.rica_match >= 80,
            current_date - (case when c.years_there >= 1 then 21 else 9 end),
            case when c.rica_match >= 80 then 'verified' else 'manual_review' end,
            case when c.rica_match >= 80 then 92 else 34 end,
            'simulation');

    -- ── Phone ──────────────────────────────────────────────────
    insert into public.phone_numbers (customer_id, subject_id, msisdn, msisdn_hash,
                                      network, line_type)
    values (v_customer, v_subject, c.msisdn,
            encode(digest('demo-msisdn-pepper|' || c.msisdn, 'sha256'), 'hex'),
            c.network, c.line_type)
    returning id into v_phone;

    insert into public.phone_verifications (phone_id, case_id, rica_status, registered_name,
      name_match_score, tenure_days, otp_delivered, otp_confirmed,
      status, confidence, reason_codes, provider,
      last_sim_swap_at, days_since_sim_swap)
    values (v_phone, p.case_id, c.rica_status, c.rica_name, c.rica_match, c.tenure_days,
            true, c.rica_match >= 80,
            case when c.rica_status = 'registered_to_subject' then 'verified' else 'manual_review' end,
            case when c.rica_status = 'registered_to_subject' then c.rica_match else 18 end,
            case when c.rica_status = 'registered_to_subject' then '{}'::text[]
                 else array['rica_registered_to_other'] end,
            'simulation',
            case when c.tenure_days < 90 then now() - make_interval(days => c.tenure_days) end,
            case when c.tenure_days < 90 then c.tenure_days end);

    -- ── Employer and employment ────────────────────────────────
    if c.employer is not null and c.employer <> 'Not supplied' then
      -- Two people can work for the same company, and one of these
      -- employers is already on file from seed_lifecycle.sql. The unique
      -- key is (name_normalised, registration_number) and a null
      -- registration number never conflicts, so look it up rather than
      -- relying on ON CONFLICT.
      select id into v_employer from public.employers
        where name_normalised = lower(c.employer) limit 1;

      if v_employer is null then
        insert into public.employers (name, name_normalised, registration_number,
                                      cipc_status, cipc_checked_at, sector, flagged, flag_reason)
        values (c.employer, lower(c.employer), c.cipc_reg, c.cipc_status, now(), c.sector,
                c.cipc_status = 'not_found',
                case when c.cipc_status = 'not_found'
                     then 'No CIPC registration found for this name' end)
        returning id into v_employer;
      end if;

      insert into public.employment_records (customer_id, subject_id, employer_id,
        employer_name_claimed, job_title, employment_type, started_on,
        gross_monthly_cents, net_monthly_cents, pay_frequency, pay_day)
      values (v_customer, v_subject, v_employer, c.employer, c.job_title, c.emp_type,
              (current_date - (c.emp_years * 365)::int), c.gross_cents, c.net_cents,
              'monthly', 25)
      returning id into v_emp;

      -- The arithmetic is checked, not taken on trust. Only the fraud
      -- file fails it, and it fails because the numbers genuinely do
      -- not add up.
      insert into public.employment_verifications (employment_id, case_id, method,
        employer_exists, payslip_arithmetic_ok, declared_gross_cents, declared_net_cents,
        computed_net_cents, observed_deposit_cents, income_variance_pct,
        status, confidence, reason_codes, provider)
      values (v_emp, p.case_id, 'payslip',
              c.cipc_status = 'in_business',
              p.arc <> 'fraud',
              c.gross_cents, c.net_cents,
              c.net_cents,
              case when p.arc = 'fraud' then 1200000 else c.net_cents end,
              case when p.arc = 'fraud'
                   then round(((c.net_cents - 1200000)::numeric / 1200000) * 100, 2)
                   else 0 end,
              case when p.arc = 'fraud' then 'failed'
                   when c.cipc_status = 'in_business' then 'verified'
                   else 'manual_review' end,
              case when p.arc = 'fraud' then 6
                   when c.emp_years >= 2 then 94 else 78 end,
              case when p.arc = 'fraud'
                   then array['payslip_net_does_not_reconcile','employer_not_at_cipc','income_variance_high']
                   else '{}'::text[] end,
              'simulation');
    end if;

    -- ── Bank account ───────────────────────────────────────────
    insert into public.bank_accounts (customer_id, subject_id, bank_name, branch_code,
      account_type, account_last4, account_hash, account_holder_name,
      avs_status, avs_checked_at)
    values (v_customer, v_subject, c.bank, c.branch, c.acct_type, c.acct_last4,
            -- The fraud file shares an account with two other identities
            -- already in the base seed, which is what lights the rule.
            case when p.key = 'lwazi' then 'seed-hash-shared-account'
                 else encode(digest('demo-account-pepper|' || p.key, 'sha256'), 'hex') end,
            c.holder, c.avs_status,
            case when c.avs_status <> 'unavailable' then now() end);
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════
-- 4 · The follow-on cases
--
-- The onboarding case for each person is created in the loop above,
-- because their customer record points at it. These are the cases that
-- came after: periodic FICA refreshes, a payout check, an age gate.
-- ══════════════════════════════════════════════════════════════

-- ── The follow-on cases: refreshes, payouts, an age gate ────────
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('VC-2026-000025','sipho',    'biprapay', 'MRC-KYC-0031',   'kyc_refresh',     'basic',    'verified',   'low', 'refresh',   2),
      ('VC-2026-000026','johan',    'biprapay', 'MRC-KYC-0051',   'kyc_refresh',     'basic',    'verified',   'low', 'refresh',   1),
      ('VC-2026-000027','nokuthula','xpayments','XP-KYC-2048',    'kyc_refresh',     'basic',    'verified',   'low', 'refresh',   1),
      ('VC-2026-000028','rethabile','xpayments','XP-KYC-2050',    'kyc_refresh',     'basic',    'expired',    'low', 'refresh',  14),
      ('VC-2026-000029','anele',    'veribills','ACC-KYC-0320',   'kyc_refresh',     'basic',    'in_progress','low', 'in_progress',0),
      ('VC-2026-000030','mandla',   'veribills','ACC-PAY-9911',   'payout',          'standard', 'verified',   'low', 'clean_a',   1),
      ('VC-2026-000031','kagiso',   'piggybag', 'PB-AGE-7741',    'age_check',       'basic',    'verified',   'low', 'agecheck',  6),
      ('VC-2026-000032','fatima',   'xpayments','LOAN-2026-0560', 'account_recovery','standard', 'cancelled',  'low', 'in_progress',0)
    ) as t(case_id, key, platform, client_ref, purpose, level, status, risk, arc, months_ago)
  loop
    insert into public.verification_cases (id, subject_id, platform_id, client_reference,
      purpose, level, status, risk, score, expires_at, decided_at, created_at)
    select r.case_id, s.id, r.platform, r.client_ref, r.purpose, r.level, r.status, r.risk, 0,
           case when r.status = 'verified' then now() + interval '12 months' - make_interval(months => r.months_ago)
                when r.status = 'expired'  then now() - interval '2 months' end,
           case when r.status = 'verified' then now() - make_interval(months => r.months_ago) end,
           now() - make_interval(months => r.months_ago)
    from public.subjects s where s.id_hash = 'seed-subject-' || r.key;

    insert into public.verification_checks (case_id, domain, check_type, provider,
                                            status, score, result, reason_codes, created_at)
    select r.case_id, a.domain, a.check_type, a.provider, a.status, a.score,
           a.result, a.reason_codes, now() - make_interval(months => r.months_ago)
    from demo_arc_check a where a.arc = r.arc;
  end loop;
end $$;

-- ── Watchlist adjudication on the PEP near-match ────────────────
insert into public.watchlist_hits (case_id, entry_id, match_score, status, review_note)
select 'VC-2026-000023', e.id, 88, 'open',
       'Surname and initial match a municipal supply chain official; date of birth differs by 11 years. Awaiting documentary confirmation.'
from public.watchlist_entries e where e.full_name = 'Gerhardus Venter' limit 1;

-- ══════════════════════════════════════════════════════════════
-- 5 · Identity, document, credit and biometric detail
-- ══════════════════════════════════════════════════════════════

-- ── Identity verification records ───────────────────────────────
insert into public.identity_verifications (case_id, subject_id, id_type, id_last4,
  structure_valid, derived_date_of_birth, derived_gender, derived_citizenship,
  claimed_name, authority_name, name_match_score, authority_provider, authority_status,
  deceased_flag, watchlist_hit, created_at)
select p.case_id, s.id, 'sa_id', p.id_last4, true,
       -- The identity number carries the date of birth in its first six
       -- digits. On the fraud file it decodes to a different date from the
       -- one on the application, which is what dob_inconsistent looks for.
       case when p.arc = 'fraud' then p.dob - interval '3 years 2 months'
            else p.dob end::date,
       p.gender, p.citizenship,
       p.first_names || ' ' || p.surname,
       case when p.arc = 'fraud' then upper(left(p.first_names,1)) || ' ' || p.surname
            else p.first_names || ' ' || p.surname end,
       case when p.arc = 'fraud' then 61 else 100 end,
       'simulation',
       'match',
       p.arc = 'deceased',
       p.arc = 'watchlist',
       now() - make_interval(months => greatest(p.onboard_months, 0))
from demo_person p
join public.subjects s on s.id_hash = 'seed-subject-' || p.key
where p.arc <> 'in_progress';

-- ── Documents and their examination ─────────────────────────────
-- Every file carries an ID document; anyone being lent to also has
-- proof of address, a payslip and three months of bank statements,
-- which is what an NCA-compliant affordability file actually needs.
do $$
declare
  p record;
  c record;
  v_subject uuid;
  v_doc uuid;
  d record;
  v_sha text;
  v_auth numeric;
begin
  for p in select * from demo_person where arc <> 'in_progress' order by key loop
    select * into c from demo_contact where key = p.key;
    select id into v_subject from public.subjects where id_hash = 'seed-subject-' || p.key;

    for d in
      select * from (values
        ('sa_id_card',       'front', 1),
        ('proof_of_address', null,    1),
        ('payslip',          null,    1),
        ('bank_statement',   null,    3)
      ) as t(doc_type, face, pages)
    loop
      -- Only lending files carry the income documents.
      continue when d.doc_type in ('payslip','bank_statement')
                and p.purpose not in ('lending','onboarding');
      continue when d.doc_type in ('payslip','bank_statement')
                and p.cust_no is null;

      -- The fraud file re-uses a document already on another identity;
      -- detect_document_reuse() finds it by sha256, so the hash has to
      -- genuinely collide rather than merely be labelled as a match.
      v_sha := case
        when p.key = 'lwazi' and d.doc_type = 'payslip'
          then encode(digest('demo-document|shared-payslip', 'sha256'), 'hex')
        else encode(digest('demo-document|' || p.key || '|' || d.doc_type, 'sha256'), 'hex')
      end;

      insert into public.documents (case_id, subject_id, doc_type, storage_path,
        mime_type, size_bytes, page_count, sha256, uploaded_via, retention_until, created_at)
      values (p.case_id, v_subject, d.doc_type,
              p.case_id || '/' || d.doc_type || coalesce('_' || d.face, '') || '.jpg',
              case when d.doc_type = 'bank_statement' then 'application/pdf' else 'image/jpeg' end,
              case when d.doc_type = 'bank_statement' then 412000 else 1840000 end,
              d.pages, v_sha, 'api',
              -- FICA s22: five years from the end of the relationship.
              now() + interval '5 years' - make_interval(months => greatest(p.onboard_months,0)),
              now() - make_interval(months => greatest(p.onboard_months, 0)))
      returning id into v_doc;

      v_auth := case when p.arc = 'fraud' then 11 else 88 + (length(p.key) % 9) end;

      if d.doc_type = 'sa_id_card' then
        insert into public.document_verifications (case_id, document_id, doc_type,
          mrz_present, mrz_valid, mrz_fields, extracted, document_number_last4,
          date_of_issue, date_of_expiry, expired, stale,
          authenticity_score, tamper_signals, provider, status, reason_codes)
        values (p.case_id, v_doc, d.doc_type, true, p.arc <> 'fraud',
                jsonb_build_object('document_type','ID','issuing_state','ZAF',
                                   'surname', upper(p.surname), 'given_names', upper(p.first_names),
                                   'date_of_birth', to_char(p.dob,'YYMMDD'),
                                   'composite_check_valid', p.arc <> 'fraud'),
                jsonb_build_object('full_name', p.first_names || ' ' || p.surname,
                                   'nationality','South African'),
                p.id_last4,
                (p.dob + interval '18 years')::date + 400,
                (current_date + interval '4 years')::date,
                false, false,
                v_auth,
                case when p.arc = 'fraud' then
                  '[{"code":"font_mismatch","severity":"critical","detail":"Surname field set in a face not used by DHA"},
                    {"code":"metadata_edited","severity":"critical","detail":"Producer software is a raster editor"}]'::jsonb
                else '[]'::jsonb end,
                'simulation',
                case when p.arc = 'fraud' then 'failed' else 'passed' end,
                case when p.arc = 'fraud'
                     then array['mrz_check_digit_failed_composite','tamper_font_mismatch','tamper_metadata_edited']
                     else '{}'::text[] end);

        -- Forensics on the ID image: the metadata a real examiner reads.
        insert into public.document_forensics (document_id, perceptual_hash,
          producer_software, creation_date, modification_date,
          has_digital_signature, signature_valid, findings, provider)
        values (v_doc,
                substr(encode(digest('phash|' || p.key, 'sha256'), 'hex'), 1, 16),
                case when p.arc = 'fraud' then 'Adobe Photoshop 25.9 (Windows)'
                     else 'DHA Smart Card Scanner v3.1' end,
                now() - make_interval(months => greatest(p.onboard_months,0)) - interval '2 days',
                case when p.arc = 'fraud'
                     then now() - make_interval(months => greatest(p.onboard_months,0)) - interval '4 hours'
                     else now() - make_interval(months => greatest(p.onboard_months,0)) - interval '2 days' end,
                p.arc <> 'fraud', case when p.arc <> 'fraud' then true end,
                case when p.arc = 'fraud' then
                  '[{"code":"producer_is_image_editor","severity":"critical"},
                    {"code":"modified_after_creation","severity":"critical"},
                    {"code":"no_digital_signature","severity":"warn"}]'::jsonb
                else '[]'::jsonb end,
                'simulation');
      else
        insert into public.document_verifications (case_id, document_id, doc_type,
          mrz_present, extracted, date_of_issue, expired, stale,
          authenticity_score, provider, status, reason_codes)
        values (p.case_id, v_doc, d.doc_type, false,
                jsonb_build_object('account_holder', c.holder, 'address_line1', c.line1),
                current_date - 24, false, false,
                case when p.arc = 'fraud' and d.doc_type = 'payslip' then 14 else v_auth end,
                'simulation',
                case when p.arc = 'fraud' and d.doc_type = 'payslip' then 'failed' else 'passed' end,
                case when p.arc = 'fraud' and d.doc_type = 'payslip'
                     then array['payslip_net_does_not_reconcile'] else '{}'::text[] end);
      end if;
    end loop;
  end loop;
end $$;

-- ── Bureau enquiries and the accounts behind them ───────────────
do $$
declare
  p record;
  cr record;
  v_check uuid;
  i int;
  v_creditors text[] := array['Standard Bank','Absa Home Loans','Woolworths Financial Services',
                              'Edgars Account','TFG Money','MTN Postpaid','Nedbank Vehicle Finance',
                              'Capitec Credit','African Bank Personal Loan'];
  v_types text[] := array['credit_card','instalment','revolving','clothing','telecoms',
                          'vehicle_finance','personal_loan','home_loan','overdraft'];
begin
  for p in select * from demo_person order by key loop
    select * into cr from demo_credit where key = p.key;
    continue when cr is null;

    insert into public.credit_checks (case_id, subject_id, bureau_id, enquiry_type, purpose,
      score, band, risk, accounts_total, accounts_in_arrears, worst_arrears_months,
      monthly_debt_obligations_cents, judgments, defaults, debt_review,
      provider_reference, status, reason_codes, raw_summary, created_at)
    select p.case_id, s.id, cr.bureau, cr.enquiry, p.purpose,
           cr.score, cr.band, cr.risk, cr.accounts, cr.arrears_accts, cr.worst_arrears,
           cr.obligations, cr.judgments, cr.defaults, cr.debt_review,
           upper(left(cr.bureau, 3)) || '-' || to_char(now(), 'YYYY') || '-' ||
             lpad((abs(hashtext(p.key)) % 900000 + 100000)::text, 6, '0'),
           'completed',
           case when cr.defaults > 0 and cr.judgments > 0 then array['defaults_on_record','judgment_on_record']
                when cr.defaults > 0 then array['defaults_on_record']
                when cr.accounts <= 1 then array['thin_credit_file']
                else '{}'::text[] end,
           jsonb_build_object('bureau', cr.bureau, 'enquiries_last_12m',
                              case when cr.accounts > 4 then 3 else 1 end),
           now() - make_interval(months => greatest(p.onboard_months, 0))
    from public.subjects s where s.id_hash = 'seed-subject-' || p.key
    returning id into v_check;

    -- The tradelines that produce that score. Balances and instalments
    -- are apportioned from the bureau obligation figure, so the account
    -- list adds up to the number on the summary.
    for i in 1..cr.accounts loop
      insert into public.credit_accounts (credit_check_id, creditor, account_type,
        opened_on, balance_cents, instalment_cents, months_in_arrears, status)
      values (v_check,
              v_creditors[1 + ((abs(hashtext(p.key || i)) ) % array_length(v_creditors,1))],
              v_types[1 + ((abs(hashtext(p.key || i || 'x'))) % array_length(v_types,1))],
              current_date - ((abs(hashtext(p.key || i)) % 2400) + 180),
              ((cr.obligations * 14) / cr.accounts)::bigint,
              (cr.obligations / cr.accounts)::bigint,
              case when i <= cr.arrears_accts then cr.worst_arrears else 0 end,
              case when i <= cr.arrears_accts then 'in_arrears' else 'open' end);
    end loop;
  end loop;
end $$;

-- ── Affordability, computed against the NCA minimum table ───────
insert into public.affordability_assessments (case_id, subject_id, gross_income_cents,
  statutory_deductions_cents, net_income_cents, income_verified, income_source,
  declared_expenses_cents, minimum_expenses_cents, applied_expenses_cents,
  existing_obligations_cents, proposed_instalment_cents, discretionary_income_cents,
  outcome, reason_codes, created_at)
select p.case_id, s.id,
       c.gross_cents,
       c.gross_cents - c.net_cents,
       c.net_cents,
       p.arc <> 'fraud',
       case when p.arc = 'fraud' then 'Payslip — failed verification' else 'Payslip — verified' end,
       -- Declared living expenses. Below the NCA Regulation 23A floor
       -- for a couple of files, which is exactly when applied_expenses
       -- has to be the greater of the two.
       v.declared,
       public.nca_minimum_expenses_cents(c.net_cents),
       greatest(v.declared, public.nca_minimum_expenses_cents(c.net_cents)),
       cr.obligations,
       coalesce(f.instalment, 0),
       c.net_cents
         - greatest(v.declared, public.nca_minimum_expenses_cents(c.net_cents))
         - cr.obligations - coalesce(f.instalment, 0),
       case
         when p.arc = 'fraud' then 'not_affordable'
         when c.net_cents - greatest(v.declared, public.nca_minimum_expenses_cents(c.net_cents))
              - cr.obligations - coalesce(f.instalment, 0) < 0 then 'not_affordable'
         when c.net_cents - greatest(v.declared, public.nca_minimum_expenses_cents(c.net_cents))
              - cr.obligations - coalesce(f.instalment, 0) < 150000 then 'marginal'
         else 'affordable'
       end,
       case when p.arc = 'fraud'
            then array['payslip_net_does_not_reconcile','income_not_verified']
            else '{}'::text[] end,
       now() - make_interval(months => greatest(p.onboard_months, 0))
from demo_person p
join demo_contact c on c.key = p.key
join demo_credit cr on cr.key = p.key
join public.subjects s on s.id_hash = 'seed-subject-' || p.key
cross join lateral (select (c.net_cents * 0.34)::bigint as declared) v
left join lateral (
  select public.instalment_cents(fi.principal, fi.rate, fi.term, 0) as instalment
  from demo_finance fi where fi.key = p.key
) f on true;

-- ── Biometric enrolment and matching ────────────────────────────
-- Two templates per person: one lifted from the document portrait, one
-- from the live capture. The live vector is a controlled walk away from
-- the document vector, so cosine_similarity() returns a real number in
-- the right place rather than a figure typed in by hand.
do $$
declare
  p record;
  v_subject uuid;
  v_doc_template uuid;
  v_live_template uuid;
  v_seed int;
  v_noise numeric;
  v_sim numeric;
  v_doc_id uuid;
begin
  for p in select * from demo_person
           where arc in ('clean_a','clean_b','thin_credit','marginal','fraud','watchlist')
           order by key loop
    select id into v_subject from public.subjects where id_hash = 'seed-subject-' || p.key;
    select id into v_doc_id from public.documents
      where case_id = p.case_id and doc_type = 'sa_id_card' limit 1;

    v_seed := abs(hashtext(p.key)) % 9000 + 100;
    -- The impostor's live capture is a different face entirely.
    v_noise := case when p.arc = 'fraud' then 2.50
                    when p.arc = 'marginal' then 0.80
                    else 0.45 + ((abs(hashtext(p.key)) % 20)::numeric / 100) end;

    insert into public.biometric_templates (subject_id, modality, model_id, descriptor,
      descriptor_hash, source, source_document_id, quality_score, retention_until)
    values (v_subject, 'face', 'sim-face-v1',
            pg_temp.demo_descriptor(v_seed, 128, 0),
            encode(digest('demo-template|' || p.key || '|doc', 'sha256'), 'hex'),
            'document_portrait', v_doc_id, 88,
            now() + interval '5 years')
    returning id into v_doc_template;

    insert into public.biometric_templates (subject_id, modality, model_id, descriptor,
      descriptor_hash, source, quality_score, retention_until)
    values (v_subject, 'face', 'sim-face-v1',
            pg_temp.demo_descriptor(v_seed, 128, v_noise),
            encode(digest('demo-template|' || p.key || '|live', 'sha256'), 'hex'),
            'live_capture', 91, now() + interval '5 years')
    returning id into v_live_template;

    select public.cosine_similarity(
             (select descriptor from public.biometric_templates where id = v_doc_template),
             (select descriptor from public.biometric_templates where id = v_live_template))
      into v_sim;

    insert into public.biometric_verifications (case_id, subject_id, modality, model_id,
      mode, template_id, similarity, threshold_applied, operating_fmr, matched,
      liveness_performed, liveness_score, liveness_passed, pad_level, attack_type,
      quality_score, provider, status, reason_codes, latency_ms, created_at)
    values (p.case_id, v_subject, 'face', 'sim-face-v1', 'verify', v_doc_template,
            v_sim, 0.68, '1e-5', v_sim >= 0.68,
            true,
            case when p.arc = 'fraud' then 91 else 94 + (abs(hashtext(p.key)) % 5) end,
            true, 2, 'none',
            91, 'simulation',
            case when v_sim >= 0.68 then 'passed' else 'failed' end,
            case when v_sim >= 0.68 then '{}'::text[] else array['face_below_threshold'] end,
            420 + (abs(hashtext(p.key)) % 380),
            now() - make_interval(months => greatest(p.onboard_months, 0)));

    -- Fingerprint, where the branch has a reader.
    if p.arc in ('clean_a','clean_b') then
      insert into public.biometric_templates (subject_id, modality, model_id, descriptor,
        descriptor_hash, source, quality_score, retention_until)
      values (v_subject, 'fingerprint', 'sim-finger-v1',
              pg_temp.demo_descriptor(v_seed + 5000, 96, 0),
              encode(digest('demo-template|' || p.key || '|finger', 'sha256'), 'hex'),
              'live_capture', 86, now() + interval '5 years')
      returning id into v_live_template;

      insert into public.biometric_verifications (case_id, subject_id, modality, model_id,
        mode, template_id, similarity, threshold_applied, operating_fmr, matched,
        liveness_performed, quality_score, provider, status, latency_ms, created_at)
      values (p.case_id, v_subject, 'fingerprint', 'sim-finger-v1', 'enrol', v_live_template,
              1.0, 0.71, '1e-5', true, false, 86, 'simulation', 'passed',
              210 + (abs(hashtext(p.key)) % 140),
              now() - make_interval(months => greatest(p.onboard_months, 0)));
    end if;
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════
-- 6 · Assets, agreements and the payment book
-- ══════════════════════════════════════════════════════════════

do $$
declare
  f record;
  p record;
  v_customer uuid;
  v_asset uuid;
  v_start date;
  n_due int;
  n_paid int;
  i int;
  s record;
  v_pay uuid;
  v_offset int;
begin
  for f in select * from demo_finance order by key loop
    select * into p from demo_person where key = f.key;
    select c.id into v_customer from public.customers c
      join public.subjects s2 on s2.id = c.subject_id
      where s2.id_hash = 'seed-subject-' || f.key;

    insert into public.assets (platform_id, asset_type, make, model, variant, year, colour,
      vin, engine_number, registration_number, imei, serial_number,
      retail_value_cents, trade_value_cents, valued_on, odometer_km,
      condition, status, registry_verified, registry_verified_at, registry_status)
    values (p.platform, f.asset_type, f.make, f.model, f.variant, f.yr, f.colour,
            f.vin, f.engine_no, f.reg_no, f.imei, f.serial_no,
            f.retail_cents, f.trade_cents,
            current_date - (f.months_ago * 30), f.odo,
            f.condition,
            case when f.pattern = 'settled' then 'sold' else 'financed' end,
            f.registry <> 'unavailable',
            case when f.registry <> 'unavailable' then now() - make_interval(months => f.months_ago) end,
            f.registry)
    returning id into v_asset;

    v_start := (current_date - make_interval(months => f.months_ago))::date;

    insert into public.contracts (id, customer_id, platform_id, asset_id, agreement_type,
      origination_case_id, status, principal_cents, deposit_cents,
      initiation_fee_cents, monthly_service_fee_cents, interest_rate_pct, rate_type,
      term_months, instalment_cents, first_payment_date, payment_day,
      collection_method, created_at)
    values (f.contract_id, v_customer, p.platform, v_asset, f.agreement,
            p.case_id, 'active', f.principal, f.deposit,
            -- NCA-capped initiation fee, rounded to the rand.
            least(round(f.principal * 0.10 / 100.0) * 100 + 116900, 128250),
            case when f.agreement = 'phone_contract' then 0 else 6900 end,
            f.rate, 'fixed', f.term,
            public.instalment_cents(f.principal, f.rate, f.term, 0),
            v_start, f.pay_day, f.collection,
            now() - make_interval(months => f.months_ago) - interval '3 days');

    perform public.generate_payment_schedule(f.contract_id);

    -- Instalments that have fallen due by today.
    n_due := least(f.months_ago + 1, f.term);

    n_paid := case f.pattern
                when 'clean'    then n_due
                when 'late'     then n_due
                when 'slipping' then greatest(n_due - 2, 0)
                when 'arrears'  then greatest(n_due - 3, 0)
                when 'default'  then 1
                when 'nothing'  then 0
                when 'settled'  then f.term
              end;

    for i in 1..n_paid loop
      select * into s from public.payment_schedule
        where contract_id = f.contract_id and instalment_no = i;

      -- A late payer arrives after the due date, by a different number
      -- of days each month, which is what makes payment_behaviour()
      -- rate them as late rather than delinquent.
      v_offset := case when f.pattern = 'late'
                       then 9 + (abs(hashtext(f.key || i)) % 9)
                       else 0 end;

      insert into public.payments (contract_id, customer_id, amount_cents, paid_at,
        method, source_platform, external_reference, status)
      values (f.contract_id, v_customer, s.amount_due_cents,
              (s.due_date + v_offset)::timestamptz + interval '9 hours',
              f.collection, p.platform,
              upper(left(p.platform, 2)) || '-COL-' ||
                to_char(s.due_date, 'YYYYMM') || '-' || lpad(i::text, 4, '0'),
              'received')
      returning id into v_pay;

      perform public.allocate_payment(v_pay);
    end loop;

    -- A settled agreement is settled: the recompute function respects a
    -- terminal status a human set and will not walk it back.
    if f.pattern = 'settled' then
      update public.contracts
         set status = 'settled',
             settled_at = (v_start + make_interval(months => f.term))::timestamptz
       where id = f.contract_id;
    end if;

    perform public.recompute_contract_position(f.contract_id);
  end loop;
end $$;

-- ── A reversed debit order on the slipping file ─────────────────
-- Presented, bounced, reversed. The allocation is unwound, so the
-- instalment goes back to unpaid and the arrears position moves.
do $$
declare
  v_contract text := 'CT-XPAY-2025-00041';
  v_customer uuid;
  v_due bigint;
  v_date date;
  v_pay uuid;
begin
  select customer_id into v_customer from public.contracts where id = v_contract;
  select amount_due_cents, due_date into v_due, v_date
  from public.payment_schedule
  where contract_id = v_contract and amount_paid_cents = 0 and due_date <= current_date
  order by instalment_no limit 1;

  if v_due is not null then
    insert into public.payments (contract_id, customer_id, amount_cents, paid_at, method,
      source_platform, external_reference, status)
    values (v_contract, v_customer, v_due, v_date::timestamptz + interval '9 hours',
            'debit_order', 'xpayments',
            'XP-COL-' || to_char(v_date, 'YYYYMM') || '-RVSL', 'received')
    returning id into v_pay;

    perform public.allocate_payment(v_pay);
    perform public.reverse_payment(v_pay, 'Debit order returned unpaid — insufficient funds');
    perform public.recompute_contract_position(v_contract);
  end if;
end $$;

-- ── Stock on the floor, unencumbered ────────────────────────────
-- So the assets page shows a dealership's actual position: what is
-- financed, what is available, and what came back.
insert into public.assets (platform_id, asset_type, make, model, variant, year, colour,
  vin, engine_number, retail_value_cents, trade_value_cents, valued_on, odometer_km,
  condition, status, registry_verified, registry_verified_at, registry_status) values
  ('biprapay','vehicle_passenger','Toyota','Starlet','1.5 XR Auto',2026,'Chromium Silver',
   'AHTKB3BE00A221904','K15B221904',31990000,28100000,current_date - 4,18,'new','available',true,now(),'clear'),
  ('biprapay','vehicle_passenger','Suzuki','Fronx','1.5 GLX Auto',2026,'Splendid Silver',
   'MA3EYD61SPA118337','K15C118337',36990000,32400000,current_date - 4,12,'new','available',true,now(),'clear'),
  ('biprapay','vehicle_commercial','Toyota','Hilux','2.8 GD-6 Raider 4x4',2025,'Graphite Grey',
   'AHTFR22G20A331207','1GD331207',78990000,69500000,current_date - 11,4300,'demo','reserved',true,now(),'clear'),
  ('xpayments','vehicle_passenger','Volkswagen','Polo Vivo','1.4 Trendline',2024,'Candy White',
   'AAVZZZ6RZRU440118','CLS440118',25990000,21800000,current_date - 18,52400,'used','available',true,now(),'clear'),
  ('xpayments','vehicle_passenger','Hyundai','i20','1.2 Motion',2023,'Titan Grey',
   'MALBB51CBPM880412','G3LC880412',27990000,22600000,current_date - 22,71300,'used','repossessed',true,now(),'encumbered'),
  ('veribills','handset','Samsung','Galaxy S24 FE','256 GB',2025,'Graphite',
   null,null,1499900,null,current_date - 30,null,'new','available',false,null,'unavailable'),
  ('veribills','handset','Huawei','nova 12 SE','256 GB',2025,'Starry Black',
   null,null,799900,null,current_date - 30,null,'new','available',false,null,'unavailable'),
  ('mysmme','solar_system','Deye','8kW Hybrid Inverter','with 10.24 kWh Freedom Won',2026,null,
   null,null,17400000,null,current_date - 6,null,'new','available',false,null,'unavailable');

-- ── The unit NaTIS says is already under finance ────────────────
-- A note on asset_already_financed, which a client will ask about: it
-- cannot be demonstrated by seeding two live agreements against one
-- asset, because contracts_one_live_per_asset is a unique index that
-- refuses the second one outright. The database prevents that state
-- rather than detecting it, and the rule stays as a backstop for data
-- arriving by migration.
--
-- What a lender does see is this: the registry disagrees with the deal
-- in front of them. NaTIS reports the Chery on the fraud file as
-- encumbered — already under finance somewhere else — which is what
-- asset_registry_adverse looks for, and it is reachable.
update public.assets a
   set registry_status = 'encumbered',
       registry_verified = true,
       registry_verified_at = now() - interval '3 months'
  from public.contracts ct
 where ct.id = 'CT-BIPR-2026-00052' and a.id = ct.asset_id;

-- ══════════════════════════════════════════════════════════════
-- 7 · Live capture sessions and what the agents made of them
-- ══════════════════════════════════════════════════════════════

do $$
declare
  r record;
  v_session text;
  v_subject uuid;
  v_customer uuid;
  v_run uuid;
  v_sim numeric;
begin
  for r in
    select * from (values
      ('CS-2026-000101','sipho',    'dealership',   'approved','Randburg branch — Kiosk 2',      'accepted', 26),
      ('CS-2026-000102','zanele',   'dealership',   'approved','Randburg branch — Kiosk 1',      'accepted', 18),
      ('CS-2026-000103','aisha',    'branch',       'approved','Parklands branch — Counter 3',   'accepted', 12),
      ('CS-2026-000104','tebogo',   'self_service', 'review',  'Applicant device (Android)',     'pending',  9),
      ('CS-2026-000105','chantal',  'branch',       'approved','Bothasig branch — Counter 1',    'accepted', 21),
      ('CS-2026-000106','precious', 'field_agent',  'approved','Field tablet FT-114',            'accepted', 7),
      ('CS-2026-000107','kagiso',   'self_service', 'approved','Applicant device (Android)',     'accepted', 8),
      ('CS-2026-000108','fatima',   'branch',       'review',  'Rosebank branch — Counter 2',    'pending',  5),
      ('CS-2026-000109','lwazi',    'dealership',   'declined','Bloemfontein branch — Kiosk 1',  'accepted', 4),
      ('CS-2026-000110','thandeka', 'self_service', 'capturing','Applicant device (iOS)',        null,       0),
      ('CS-2026-000111','bongani',  'field_agent',  'approved','Field tablet FT-207',            'accepted', 12),
      ('CS-2026-000112','anele',    'branch',       'approved','Mitchells Plain — Counter 4',    'overridden',14)
    ) as t(session_id, key, channel, status, device, human_outcome, months_ago)
  loop
    select id into v_subject from public.subjects where id_hash = 'seed-subject-' || r.key;
    select id into v_customer from public.customers where subject_id = v_subject;

    select bv.similarity into v_sim
    from public.biometric_verifications bv
    where bv.subject_id = v_subject and bv.modality = 'face' limit 1;

    insert into public.capture_sessions (id, platform_id, case_id, subject_id, customer_id,
      channel, status, required_steps, completed_steps, device_label,
      started_at, completed_at, expires_at, created_at)
    select r.session_id, p.platform, p.case_id, v_subject, v_customer, r.channel, r.status,
           array['consent','document','selfie','match'],
           case when r.status = 'capturing' then array['consent','document']
                else array['consent','document','selfie','match'] end,
           r.device,
           now() - make_interval(months => r.months_ago),
           case when r.status <> 'capturing'
                then now() - make_interval(months => r.months_ago) + interval '7 minutes' end,
           now() - make_interval(months => r.months_ago) + interval '2 hours',
           now() - make_interval(months => r.months_ago)
    from demo_person p where p.key = r.key;

    -- The captures themselves. The quality metrics are the sort a
    -- browser actually measures: Laplacian variance for sharpness, mean
    -- and standard deviation of luminance for brightness and contrast.
    insert into public.captures (session_id, capture_type, source, storage_path, mime_type,
      size_bytes, width, height, sha256, sharpness, brightness, contrast,
      face_detected, face_count, face_area_pct, quality_score, quality_passed,
      quality_reasons, sample_discarded_at, created_at)
    values
      (r.session_id, 'document_front', 'live_camera',
       r.session_id || '/document_front.jpg', 'image/jpeg', 1640000, 1920, 1080,
       encode(digest('demo-capture|' || r.session_id || '|doc', 'sha256'), 'hex'),
       182.40 + (abs(hashtext(r.key)) % 60), 54.20, 31.80,
       true, 1, 11.40, 92.00, true, '{}',
       now() - make_interval(months => r.months_ago) + interval '9 minutes',
       now() - make_interval(months => r.months_ago) + interval '2 minutes'),

      (r.session_id, 'document_portrait', 'live_camera',
       r.session_id || '/document_portrait.jpg', 'image/jpeg', 210000, 480, 640,
       encode(digest('demo-capture|' || r.session_id || '|portrait', 'sha256'), 'hex'),
       96.10, 51.60, 27.40, true, 1, 62.30, 86.00, true, '{}',
       now() - make_interval(months => r.months_ago) + interval '9 minutes',
       now() - make_interval(months => r.months_ago) + interval '3 minutes');

    if r.status <> 'capturing' then
      insert into public.captures (session_id, capture_type, source, storage_path, mime_type,
        size_bytes, width, height, sha256, sharpness, brightness, contrast,
        face_detected, face_count, face_area_pct, quality_score, quality_passed,
        quality_reasons, sample_discarded_at, created_at)
      values (r.session_id, 'selfie', 'live_camera',
        r.session_id || '/selfie.jpg', 'image/jpeg', 940000, 1280, 960,
        encode(digest('demo-capture|' || r.session_id || '|selfie', 'sha256'), 'hex'),
        141.70 + (abs(hashtext(r.key || 's')) % 50), 57.90, 29.60,
        true, 1, 34.80, 94.00, true, '{}',
        now() - make_interval(months => r.months_ago) + interval '9 minutes',
        now() - make_interval(months => r.months_ago) + interval '5 minutes');
    end if;

    continue when r.status = 'capturing';

    -- ── The adjudication ─────────────────────────────────────────
    insert into public.agent_runs (session_id, case_id, customer_id, recommendation,
      confidence, vetoed_by, summary, human_outcome, decided_at, override_reason,
      latency_ms, created_at)
    select r.session_id, p.platform_case, v_customer,
           case r.status when 'approved' then 'approve'
                         when 'declined' then 'decline'
                         else 'refer' end,
           case r.status
             when 'approved' then 88.0 + (abs(hashtext(r.key)) % 90)::numeric / 10
             when 'declined' then 95.0 + (abs(hashtext(r.key)) % 40)::numeric / 10
             else 56.0 + (abs(hashtext(r.key)) % 110)::numeric / 10
           end,
           case when r.status = 'declined' then 'document_agent' end,
           case r.status
             when 'approved' then
               'Identity confirmed against Home Affairs, document machine-readable zone verified, '
               || 'live capture matched the document portrait at ' || coalesce(round(v_sim, 2)::text, 'n/a')
               || ' against a 0.68 threshold. No fraud signal above the block score. Approve.'
             when 'declined' then
               'The identity document fails its composite check digit and carries two critical tamper '
               || 'signals; the live capture does not match the document portrait; the payslip does not '
               || 'reconcile and the employer is not registered at CIPC. Decline.'
             else
               'Identity and document are sound and the face matched. The bureau file is too thin to '
               || 'price the agreement and the affordability margin is under R1 500. Refer to a credit '
               || 'officer.'
           end,
           r.human_outcome,
           case when r.human_outcome is not null and r.human_outcome <> 'pending'
                then now() - make_interval(months => r.months_ago) + interval '22 minutes' end,
           case when r.human_outcome = 'overridden'
                then 'Branch manager accepted a lower face-match score on a customer known to the '
                     || 'branch for eight years; second operator witnessed the capture.' end,
           1840 + (abs(hashtext(r.key)) % 900),
           now() - make_interval(months => r.months_ago) + interval '7 minutes'
    from (select case_id as platform_case from demo_person where key = r.key) p
    returning id into v_run;

    -- Each agent's own verdict. The orchestrator does not vote; it
    -- combines. Nothing here is a language model — every one of these
    -- is a rule over the rows above, which is why the same file always
    -- produces the same answer.
    insert into public.agent_decisions (run_id, agent_id, verdict, confidence,
                                        rationale, evidence, reason_codes)
    values
      (v_run, 'identity_agent',
       'pass', 95 + (abs(hashtext(r.key || 'i')) % 5),
       'Identity number is structurally valid and its check digit holds. Home Affairs returned a '
       || 'match on name and date of birth. Not on the deceased register. No watchlist hit.',
       jsonb_build_object('authority_status','match','name_match_score',100,'deceased',false), '{}'),

      (v_run, 'document_agent',
       case when r.status = 'declined' then 'fail' else 'pass' end,
       case when r.status = 'declined' then 97 + (abs(hashtext(r.key)) % 3)
            else 91 + (abs(hashtext(r.key)) % 8) end,
       case when r.status = 'declined'
            then 'The machine-readable zone''s composite check digit does not verify. Image metadata '
                 || 'shows the file was produced in a raster editor and modified after creation. Two '
                 || 'critical tamper signals. This document is not genuine.'
            else 'Machine-readable zone parses and every ICAO 9303 check digit verifies, including the '
                 || 'composite. Document is current. The name on the document matches the name claimed.'
       end,
       jsonb_build_object('mrz_valid', r.status <> 'declined',
                          'tamper_signals', case when r.status = 'declined' then 2 else 0 end), '{}'),

      (v_run, 'biometric_agent',
       case when r.status = 'declined' then 'fail'
            when r.status = 'review' then 'concern' else 'pass' end,
       case when r.status = 'declined' then 94 + (abs(hashtext(r.key || 'b')) % 5)
            else 87 + (abs(hashtext(r.key || 'b')) % 10) end,
       case when r.status = 'declined'
            then 'The live capture scores ' || coalesce(round(v_sim,2)::text,'n/a') || ' against the '
                 || 'document portrait, well under the 0.68 threshold. Liveness passed, so a live person '
                 || 'was present — but not the person on the document.'
            else 'Live capture scores ' || coalesce(round(v_sim,2)::text,'n/a') || ' against the document '
                 || 'portrait, above the 0.68 threshold at a 1-in-100 000 false match rate. Passive '
                 || 'liveness passed at presentation attack detection level 2. No raw image retained.'
       end,
       jsonb_build_object('similarity', v_sim, 'threshold', 0.68, 'pad_level', 2), '{}'),

      (v_run, 'fraud_agent',
       case when r.status = 'declined' then 'fail'
            when r.status = 'review' then 'concern' else 'pass' end,
       case when r.status = 'declined' then 92 + (abs(hashtext(r.key || 'f')) % 7)
            else 82 + (abs(hashtext(r.key || 'f')) % 13) end,
       case when r.status = 'declined'
            then 'The banking details are already on file under two unrelated identities, the residential '
                 || 'address is shared with two others, the SIM was swapped within the last 60 days, and '
                 || 'the payslip has been seen before on a different application.'
            when r.status = 'review'
            then 'Nothing critical. One warning: the applicant has been on the network for under a year, '
                 || 'so there is little history to compare against.'
            else 'No signal above the warning threshold. Banking, address, phone and employer are each '
                 || 'unique to this identity.'
       end,
       jsonb_build_object('critical_signals', case when r.status = 'declined' then 4 else 0 end), '{}'),

      (v_run, 'affordability_agent',
       case when r.status = 'declined' then 'fail'
            when r.status = 'review' then 'concern' else 'pass' end,
       case when r.status = 'declined' then 89 + (abs(hashtext(r.key || 'a')) % 8)
            else 79 + (abs(hashtext(r.key || 'a')) % 14) end,
       case when r.status = 'declined'
            then 'Declared net income cannot be verified: the payslip arithmetic does not reconcile and '
                 || 'the observed bank deposit is a seventh of the figure claimed. No affordability '
                 || 'assessment can be made on this evidence, which under NCA section 81 means no '
                 || 'agreement may be entered into.'
            when r.status = 'review'
            then 'Income is verified and expenses exceed the Regulation 23A minimum, but discretionary '
                 || 'income after the proposed instalment leaves a margin too thin to price with '
                 || 'confidence. A human should set the limit.'
            else 'Income verified against a payslip and three months of bank statements. Living expenses '
                 || 'are above the Regulation 23A minimum for this income band. Discretionary income '
                 || 'carries the proposed instalment with room to spare.'
       end,
       jsonb_build_object('nca_regulation','23A'), '{}'),

      (v_run, 'compliance_agent',
       'pass', 93 + (abs(hashtext(r.key || 'c')) % 7),
       'Consent is on record for identity verification, document storage, biometric processing and '
       || 'credit enquiry, each against its own versioned wording, none withdrawn. Biometric consent '
       || 'is explicit as POPIA section 27 requires for special personal information. The FICA file is '
       || 'complete: identity, proof of address and source of income. Retention is set to five years '
       || 'from the end of the relationship under FICA section 22.',
       jsonb_build_object('popia_s27_explicit_consent', true, 'fica_file_complete', true), '{}'),

      (v_run, 'orchestrator',
       case when r.status = 'declined' then 'fail'
            when r.status = 'review' then 'concern' else 'pass' end,
       case when r.status = 'approved' then 88 + (abs(hashtext(r.key)) % 9)
            when r.status = 'declined' then 95 + (abs(hashtext(r.key)) % 4)
            else 56 + (abs(hashtext(r.key)) % 11) end,
       case r.status
         when 'approved' then 'Six agents, no veto, no concern. Weighted confidence '
                              || (88 + (abs(hashtext(r.key)) % 9))::text || '. Recommend approve.'
         when 'declined' then 'The document agent vetoes, and the biometric, fraud and affordability '
                              || 'agents each fail independently. Recommend decline.'
         else 'No veto. The affordability and fraud agents each raise a concern that a rule cannot '
              || 'resolve. Recommend refer to a human.'
       end,
       jsonb_build_object('agents_run', 6, 'vetoes',
                          case when r.status = 'declined' then 1 else 0 end), '{}');
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════
-- 8 · Fraud screening
--
-- Not written by hand. run_fraud_screen() reads the addresses, phones,
-- bank accounts, documents, employers and contracts seeded above and
-- raises whatever its 23 rules actually find. The alerts on the fraud
-- page are therefore the engine's own output, and a client can change
-- a row and watch the score move.
-- ══════════════════════════════════════════════════════════════

do $$
declare
  p record;
  v_customer uuid;
begin
  for p in select * from demo_person order by key loop
    select c.id into v_customer from public.customers c
      join public.subjects s on s.id = c.subject_id
      where s.id_hash = 'seed-subject-' || p.key;

    perform public.run_fraud_screen(p.case_id, v_customer);
  end loop;
end $$;

-- Where the engine raised a critical alert, show it part-way through an
-- investigation rather than untouched, which is how a real queue looks.
update public.fraud_alerts
   set status = 'investigating',
       resolution_note = 'Assigned to the fraud desk. Bank confirmed the account is not in the '
                      || 'applicant''s name; awaiting the employer''s response on the payslip.'
 where severity in ('critical','high')
   and case_id = 'VC-2026-000017';

insert into public.known_fraud_register (entity_type, entity_value, reason, confirmed_at, active)
values
  ('account_hash','seed-hash-shared-account',
   'Account presented under three unrelated identities across two platforms', now() - interval '3 weeks', true),
  ('employer_id', (select id::text from public.employers where name_normalised = 'sentinel holdings group' limit 1),
   'Employer name used on three files, none traceable at CIPC', now() - interval '5 weeks', true),
  ('document_sha256', encode(digest('demo-document|shared-payslip','sha256'),'hex'),
   'Identical payslip image submitted on two applications under different names', now() - interval '2 weeks', true)
on conflict do nothing;

-- ══════════════════════════════════════════════════════════════
-- 9 · Credit capacity
--
-- Same discipline: assess_credit_capacity() computes each limit from
-- the bureau score, the verified income, the NCA minimum expense table,
-- the existing book and the fraud score. The stored row is whatever it
-- returned. "How much credit can be given" is an answer the system
-- works out, not a number typed into a seed.
-- ══════════════════════════════════════════════════════════════

do $$
declare
  cust record;
  r jsonb;
  v_agreement text;
  v_term int;
  v_rate numeric;
begin
  for cust in
    select c.id, c.platform_id, p.case_id, p.key,
           coalesce(f.agreement, 'unsecured_credit') as agreement,
           coalesce(f.term, 36) as term,
           coalesce(f.rate, 18.5) as rate
    from public.customers c
    join public.subjects s on s.id = c.subject_id
    join demo_person p on 'seed-subject-' || p.key = s.id_hash
    left join demo_finance f on f.key = p.key
    order by p.key
  loop
    select public.assess_credit_capacity(cust.id, cust.agreement, cust.term, cust.rate, 0)
      into r;

    continue when r->>'decision' = 'insufficient_data';

    insert into public.credit_assessments (customer_id, case_id, agreement_type,
      net_income_cents, discretionary_income_cents, existing_instalments_cents,
      existing_exposure_cents, bureau_score, bureau_band, behaviour_score, fraud_score,
      max_instalment_cents, max_principal_cents, recommended_limit_cents,
      assumed_rate_pct, assumed_term_months, risk_grade, decision, reason_codes, workings)
    values (cust.id, cust.case_id, cust.agreement,
            (r->>'net_income_cents')::bigint,
            (r->>'discretionary_income_cents')::bigint,
            -- A decline short-circuits before it computes exposure, so
            -- the key is absent rather than zero. These two columns are
            -- NOT NULL with a zero default, and an explicit null would
            -- override the default rather than fall back to it.
            coalesce((r->>'existing_instalments_cents')::bigint, 0),
            coalesce((r->>'existing_exposure_cents')::bigint, 0),
            (r->>'bureau_score')::int, r->>'bureau_band',
            (r->>'behaviour_score')::int, (r->>'fraud_score')::int,
            (r->>'max_instalment_cents')::bigint,
            (r->>'max_principal_cents')::bigint,
            (r->>'recommended_limit_cents')::bigint,
            coalesce((r->>'assumed_rate_pct')::numeric, cust.rate),
            coalesce((r->>'assumed_term_months')::int, cust.term),
            r->>'risk_grade', r->>'decision',
            array(select jsonb_array_elements_text(r->'reason_codes')),
            coalesce(r->'workings', '{}'::jsonb));
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════
-- 10 · API traffic, webhooks, audit trail and data subject requests
-- ══════════════════════════════════════════════════════════════

-- Two weeks of API calls across the platforms, weighted the way real
-- traffic is: mostly successful, a few 4xx, the occasional 5xx.
insert into public.api_requests (api_key_id, platform_id, endpoint, method, case_id,
                                 status_code, error_code, ip, latency_ms, created_at)
select k.id, k.platform_id, e.endpoint, 'POST',
       case when g.n % 7 = 0 then c.id end,
       e.status_code, e.error_code,
       '196.' || (10 + g.n % 40) || '.' || (1 + g.n % 200) || '.' || (2 + g.n % 60),
       e.base_latency + (abs(hashtext(k.id::text || g.n)) % 400),
       now() - make_interval(mins => g.n * 23)
from generate_series(1, 220) g(n)
join lateral (
  select id, platform_id from public.api_keys
  where revoked_at is null
  order by md5(id::text || g.n) limit 1
) k on true
join lateral (
  select * from (values
    ('/verify-identity',  200, null,                 180),
    ('/verify-identity',  200, null,                 180),
    ('/verify-identity',  200, null,                 180),
    ('/verify-document',  200, null,                 640),
    ('/verify-document',  200, null,                 640),
    ('/verify-biometric', 200, null,                 520),
    ('/verify-credit',    200, null,                 910),
    ('/case-decision',    200, null,                  90),
    ('/platform-verify',  200, null,                 240),
    ('/verify-identity',  422, 'invalid_id_number',   60),
    ('/verify-credit',    403, 'consent_not_granted', 45),
    ('/verify-document',  413, 'file_too_large',      30),
    ('/verify-biometric', 429, 'rate_limit_exceeded', 12),
    ('/verify-credit',    502, 'bureau_unavailable', 3100)
  ) as t(endpoint, status_code, error_code, base_latency)
  order by md5(g.n::text || t.endpoint) limit 1
) e on true
left join lateral (
  select id from public.verification_cases order by md5(id || g.n::text) limit 1
) c on true;

-- Webhook deliveries against those decisions, including one that had to
-- be retried and one the endpoint never accepted.
insert into public.webhook_deliveries (endpoint_id, event, case_id, payload, status,
  attempts, response_code, response_body, delivered_at, next_attempt_at, created_at)
select w.id, 'case.decided', c.id,
       jsonb_build_object('event','case.decided','case_id',c.id,'status',c.status,
                          'score',c.score,'risk',c.risk),
       d.status, d.attempts, d.response_code, d.response_body,
       case when d.status = 'delivered' then c.decided_at + interval '4 seconds' end,
       case when d.status = 'pending' then now() + interval '6 minutes' end,
       c.decided_at + interval '2 seconds'
from public.verification_cases c
join public.webhook_endpoints w on w.platform_id = c.platform_id
join lateral (
  select * from (values
    ('delivered', 1, 200, '{"ok":true}'),
    ('delivered', 1, 200, '{"ok":true}'),
    ('delivered', 1, 200, '{"ok":true}'),
    ('delivered', 1, 200, '{"ok":true}'),
    ('delivered', 3, 200, '{"ok":true}'),
    ('pending',   2, 503, 'upstream temporarily unavailable'),
    ('exhausted', 6, 500, 'handler raised: NullReferenceException')
  ) as t(status, attempts, response_code, response_body)
  order by md5(c.id || w.id::text) limit 1
) d on true
where c.decided_at is not null;

-- ── Audit trail ─────────────────────────────────────────────────
-- Append-only. actor_id is null throughout because these are the
-- platforms and scheduled jobs acting, not a signed-in person —
-- handle_new_user() creates the staff profiles a real actor_id would
-- point at, and no auth users exist in a seeded project.
insert into public.audit_log (actor_platform, action, entity_type, entity_id, metadata, created_at)
select c.platform_id, 'case.created', 'verification_case', c.id,
       jsonb_build_object('purpose', c.purpose, 'level', c.level), c.created_at
from public.verification_cases c;

insert into public.audit_log (actor_platform, action, entity_type, entity_id, metadata, created_at)
select c.platform_id, 'case.decided', 'verification_case', c.id,
       jsonb_build_object('status', c.status, 'score', c.score, 'risk', c.risk), c.decided_at
from public.verification_cases c where c.decided_at is not null;

insert into public.audit_log (actor_platform, action, entity_type, entity_id, metadata, created_at)
select c.platform_id, 'document.uploaded', 'document', d.id::text,
       jsonb_build_object('doc_type', d.doc_type, 'sha256_prefix', left(d.sha256, 12)), d.created_at
from public.documents d join public.verification_cases c on c.id = d.case_id;

-- Reading a document is the event that matters most: it is the only
-- path to the image, and it is logged before the signed URL is minted.
insert into public.audit_log (actor_platform, action, entity_type, entity_id, metadata, created_at)
select c.platform_id, 'document.accessed', 'document', d.id::text,
       jsonb_build_object('doc_type', d.doc_type, 'reason', 'FICA file review',
                          'url_ttl_seconds', 60),
       d.created_at + interval '3 days'
from public.documents d
join public.verification_cases c on c.id = d.case_id
where d.doc_type in ('sa_id_card','bank_statement')
  and abs(hashtext(d.id::text)) % 3 = 0;

insert into public.audit_log (actor_platform, action, entity_type, entity_id, metadata, created_at)
select co.platform_id, 'consent.granted', 'consent', co.id::text,
       jsonb_build_object('purpose', co.purpose, 'lawful_basis', co.lawful_basis,
                          'consent_text_id', co.consent_text_id,
                          'special_personal_information', co.special_personal_information),
       co.granted_at
from public.consents co;

insert into public.audit_log (actor_platform, action, entity_type, entity_id, metadata, created_at)
select ct.platform_id, 'contract.activated', 'contract', ct.id,
       jsonb_build_object('principal_cents', ct.principal_cents,
                          'instalment_cents', ct.instalment_cents,
                          'term_months', ct.term_months,
                          'agreement_type', ct.agreement_type),
       ct.created_at
from public.contracts ct;

insert into public.audit_log (actor_platform, action, entity_type, entity_id, metadata, created_at)
select a.platform_id, 'fraud.alert_raised', 'fraud_alert', a.id::text,
       jsonb_build_object('score', a.score, 'severity', a.severity,
                          'signal_count', a.signal_count,
                          'critical_count', a.critical_count),
       a.created_at
from public.fraud_alerts a;

insert into public.audit_log (actor_platform, action, entity_type, entity_id, metadata, created_at)
select null::text, 'agent.adjudicated', 'agent_run', r.id::text,
       jsonb_build_object('recommendation', r.recommendation, 'confidence', r.confidence,
                          'vetoed_by', r.vetoed_by, 'human_outcome', r.human_outcome),
       r.created_at
from public.agent_runs r;

insert into public.audit_log (actor_platform, action, entity_type, entity_id, metadata, created_at) values
  (null, 'retention.purge_run', 'job', 'retention-purge',
   '{"documents_examined":184,"documents_purged":0,"templates_expired":0,"dry_run":true}', now() - interval '1 day'),
  (null, 'retention.purge_run', 'job', 'retention-purge',
   '{"documents_examined":181,"documents_purged":0,"templates_expired":2,"dry_run":false}', now() - interval '8 days'),
  ('biprapay', 'api_key.issued',  'api_key', 'xck_live_bp...4f21', '{"scopes":["identity","document","biometric"]}', now() - interval '9 months'),
  ('biprapay', 'api_key.revoked', 'api_key', 'xck_live_bp...0a19', '{"reason":"Rotated as part of quarterly key hygiene"}', now() - interval '5 weeks');

-- ── Data subject requests ───────────────────────────────────────
-- POPIA sections 23, 24 and 11(2)(b). The 30-day clock is on due_at.
insert into public.dsar_requests (id, subject_id, requester_email, request_type, status,
  received_at, due_at, completed_at, outcome_note)
select 'DSAR-2026-0003', s.id, 'sipho.ndlovu@example.co.za', 'access', 'completed',
       now() - interval '38 days', now() - interval '8 days', now() - interval '19 days',
       'Full record exported: 1 case, 4 documents, 6 consents, 1 contract, 23 payments. '
       || 'Delivered as a signed PDF and a JSON export.'
from public.subjects s where s.id_hash = 'seed-subject-sipho';

insert into public.dsar_requests (id, subject_id, requester_email, request_type, status,
  received_at, due_at, outcome_note)
select 'DSAR-2026-0004', s.id, 'c.arendse@example.co.za', 'correction', 'in_progress',
       now() - interval '11 days', now() + interval '19 days',
       'Applicant states the residential address on file is a previous address. '
       || 'Awaiting a municipal account for the current address before amending.'
from public.subjects s where s.id_hash = 'seed-subject-chantal';

insert into public.dsar_requests (id, subject_id, requester_email, request_type, status,
  received_at, due_at, outcome_note)
select 'DSAR-2026-0005', s.id, 'l.gumede@example.co.za', 'deletion', 'rejected',
       now() - interval '21 days', now() + interval '9 days',
       'Refused under POPIA section 14(1)(a): the record is subject to a five-year retention '
       || 'obligation under FICA section 22 and is evidence in an open fraud investigation. '
       || 'Applicant notified of the reason and of the right to complain to the Information Regulator.'
from public.subjects s where s.id_hash = 'seed-subject-lwazi';

insert into public.dsar_requests (id, subject_id, requester_email, request_type, status,
  received_at, due_at, outcome_note)
select 'DSAR-2026-0006', s.id, 't.seleka@example.co.za', 'objection', 'verifying',
       now() - interval '3 days', now() + interval '27 days',
       'Objection to biometric processing. Verifying the requester''s identity before acting, '
       || 'since acting on an unverified deletion request is itself a breach.'
from public.subjects s where s.id_hash = 'seed-subject-tebogo';

insert into public.dsar_requests (id, subject_id, requester_email, request_type, status,
  received_at, due_at, outcome_note)
select 'DSAR-2026-0007', s.id, 'r.mokoena@example.co.za', 'portability', 'received',
       now() - interval '1 day', now() + interval '29 days',
       'Requests a machine-readable export for transfer to another credit provider.'
from public.subjects s where s.id_hash = 'seed-subject-rethabile';

-- One withdrawn consent, so the register shows what withdrawal does.
-- POPIA section 11(2)(b): withdrawal is always available and does not
-- undo processing already lawfully done.
update public.consents
   set withdrawn_at = now() - interval '2 days',
       withdrawal_reason = 'Data subject objected to further biometric processing (DSAR-2026-0006)'
 where purpose = 'biometric_processing'
   and subject_id = (select id from public.subjects where id_hash = 'seed-subject-tebogo');

-- ══════════════════════════════════════════════════════════════
-- 11 · Reconcile
--
-- Everything above chose statuses to illustrate an outcome. The scores
-- are then recomputed from the evidence, so no case can claim a number
-- its checks do not support.
-- ══════════════════════════════════════════════════════════════

update public.verification_cases c
set score = (public.case_score(c.id)->>'score')::int;

-- Assurance runs from the most recent verified case, not from the day
-- the customer was first onboarded. A file verified two years ago and
-- never refreshed is out of assurance, and the console should say so
-- rather than quietly carrying the original expiry forward.
update public.subjects s
   set assurance_expires_at = latest.decided_at + interval '12 months',
       assurance_level = case when latest.level = 'enhanced' then 'enhanced'
                              when latest.level = 'basic' then 'basic'
                              else 'standard' end
  from (
    select distinct on (subject_id) subject_id, decided_at, level
    from public.verification_cases
    where status = 'verified' and decided_at is not null
    order by subject_id, decided_at desc
  ) latest
 where latest.subject_id = s.id;

-- Anyone whose only cases were declined, cancelled or are still running
-- has no assurance at all, which is not the same as an expired one.
update public.subjects s
   set assurance_level = 'none', assurance_expires_at = null
 where not exists (
   select 1 from public.verification_cases c
   where c.subject_id = s.id and c.status = 'verified');

drop table demo_person, demo_contact, demo_credit, demo_finance, demo_arc_check;
