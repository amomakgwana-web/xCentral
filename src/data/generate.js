// ══════════════════════════════════════════════════════════════
// The working dataset, generated in the browser.
//
// xCentral runs against Postgres in production. Until that project is
// stood up, the console runs on this: the same tables, the same column
// names, the same arithmetic — built in memory when the page loads.
// Nothing here needs a database, a network call, or a key.
//
// Two properties matter more than volume:
//
//   It is deterministic. One fixed seed drives every choice, so the
//   same figures appear on every reload and on every machine. A number
//   that moves when you refresh is a number nobody can check.
//
//   It is computed, not typed. Instalments come from the amortisation
//   formula, arrears from comparing the schedule to what was paid,
//   behaviour from the payment record, case scores from the checks
//   that ran. Change a record and the figures that depend on it move,
//   because they were never written down in the first place.
//
// Every person, company, vehicle, account and number is invented.
// ══════════════════════════════════════════════════════════════

// ── Determinism ─────────────────────────────────────────────────
// mulberry32: small, fast, and good enough for fixture data. Seeded
// once, so the sequence — and therefore the whole dataset — is fixed.
export function rng(seed = 0x9E3779B9) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRandom(seed) {
  const next = rng(seed);
  const r = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // Weighted pick from [[value, weight], …].
    weighted(pairs) {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let t = next() * total;
      for (const [v, w] of pairs) { t -= w; if (t <= 0) return v; }
      return pairs[pairs.length - 1][0];
    },
    chance: (p) => next() < p,
    // Some of each, in a stable order.
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
  return r;
}

// ── Dates ───────────────────────────────────────────────────────
// Everything is relative to the moment the page loads, so a file that
// sits untouched for a month does not start showing stale dates.
export const NOW = new Date();

export const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000);
export const monthsAgo = (n) => {
  const d = new Date(NOW.getTime());
  d.setMonth(d.getMonth() - n);
  return d;
};
export const addMonths = (date, n) => {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  // Clamp for month lengths: 31 Jan + 1 month is 28 Feb, not 3 March.
  if (d.getDate() < day) d.setDate(0);
  return d;
};
export const iso = (d) => (d instanceof Date ? d.toISOString() : d);
export const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

// ── Identity numbers ────────────────────────────────────────────
// Only the last four digits are ever held, exactly as in the schema.
// The third-from-last is the citizenship digit — 0 for a citizen, 1
// for a permanent resident — so the four digits agree with the
// citizenship recorded beside them rather than contradicting it.
export function idLast4(random, citizenship) {
  const seq = random.int(0, 9);
  const cit = citizenship === 'permanent_resident' ? 1 : 0;
  const a = random.pick([8, 9]);
  const check = random.int(0, 9);
  return `${seq}${cit}${a}${check}`;
}

// ── Luhn, for IMEIs ─────────────────────────────────────────────
// A handset financed against an IMEI that fails its own check digit
// would be caught at the door, so the generated ones are valid.
export function luhnCheckDigit(body) {
  let sum = 0;
  for (let i = body.length - 1, k = 0; i >= 0; i--, k++) {
    let d = Number(body[i]);
    if (k % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function imei(random) {
  const tac = random.pick(['35209800', '35876509', '35341112', '86201005', '35719811', '35460209']);
  let body = tac;
  while (body.length < 14) body += String(random.int(0, 9));
  return body + luhnCheckDigit(body);
}

// ── Money ───────────────────────────────────────────────────────
// Cents throughout, as in the schema. Floating-point rand values are
// the one thing guaranteed to make two screens disagree.
export const rands = (r) => Math.round(r * 100);

// The instalment on an amortising agreement. Same formula the database
// uses: monthly rate over the term, with the balloon discounted back.
export function instalmentCents(principal, annualRatePct, termMonths, balloon = 0) {
  if (termMonths <= 0) return 0;
  const i = Number(annualRatePct) / 100 / 12;
  if (i === 0) return Math.round((principal - balloon) / termMonths);
  const f = Math.pow(1 + i, termMonths);
  const pv = principal - balloon / f;
  return Math.round((pv * i * f) / (f - 1));
}

// ── South African reference pools ───────────────────────────────
// Drawn from the country's actual language groups and places, because
// a dataset of "Test User 1" of "123 Main Street" teaches nobody
// anything about whether the system would work here. No row
// corresponds to a real person.
export const FIRST_NAMES_F = [
  'Nomsa', 'Thandeka', 'Zanele', 'Lerato', 'Palesa', 'Nokuthula', 'Refilwe', 'Precious',
  'Ayanda', 'Bongiwe', 'Dineo', 'Keabetswe', 'Mmabatho', 'Nandi', 'Nolwazi', 'Phumzile',
  'Sindiswa', 'Tebogo', 'Zodwa', 'Anele', 'Busisiwe', 'Chantal', 'Charlene', 'Elmarie',
  'Ilse', 'Jolandi', 'Marietjie', 'Riana', 'Susanna', 'Yolanda', 'Aisha', 'Fatima',
  'Nadia', 'Rehana', 'Shanaaz', 'Zainab', 'Divya', 'Kavitha', 'Priya', 'Reshma',
  'Mpho', 'Naledi', 'Kgomotso', 'Lindiwe', 'Nthabiseng', 'Rethabile', 'Boitumelo', 'Mahlatse',
  'Khanyisile', 'Sibongile', 'Tshegofatso', 'Zinhle', 'Amahle', 'Asanda', 'Buhle', 'Hlengiwe',
];

export const FIRST_NAMES_M = [
  'Sipho', 'Thabo', 'Mandla', 'Lwazi', 'Bongani', 'Kagiso', 'Tumelo', 'Sibusiso',
  'Nkosinathi', 'Themba', 'Vusi', 'Xolani', 'Zwelithini', 'Katlego', 'Lehlohonolo', 'Mothusi',
  'Johan', 'Pieter', 'Riaan', 'Gerhard', 'Hendrik', 'Jaco', 'Marius', 'Stefan',
  'Willem', 'Francois', 'Ahmed', 'Faizel', 'Ismail', 'Rashid', 'Yusuf', 'Zaid',
  'Deven', 'Kumaran', 'Naresh', 'Suresh', 'Vikash', 'Mpho', 'Karabo', 'Lesego',
  'Neo', 'Oratile', 'Reabetswe', 'Tshepo', 'Andile', 'Ayabonga', 'Luthando', 'Mxolisi',
  'Sandile', 'Siyabonga', 'Simphiwe', 'Musa', 'Jabulani', 'Phumlani', 'Nkululeko', 'Mncedisi',
];

export const SURNAMES = [
  'Mokoena', 'Dlamini', 'Nkosi', 'Ndlovu', 'Khumalo', 'Mthembu', 'Zwane', 'Sithole',
  'Mahlangu', 'Molefe', 'Radebe', 'Mabaso', 'Zulu', 'Ngcobo', 'Gumede', 'Maluleke',
  'Mnguni', 'Shabalala', 'Buthelezi', 'Cele', 'Mkhize', 'Zungu', 'Xaba', 'Hadebe',
  'Botha', 'van der Merwe', 'Pretorius', 'du Plessis', 'Venter', 'Swanepoel', 'Nel', 'Fourie',
  'Coetzee', 'Steyn', 'van Wyk', 'Joubert', 'le Roux', 'Kruger', 'Meyer', 'Smit',
  'Patel', 'Naidoo', 'Pillay', 'Govender', 'Reddy', 'Moodley', 'Singh', 'Khan',
  'Adams', 'Arendse', 'Abrahams', 'Daniels', 'Hendricks', 'Isaacs', 'Jacobs', 'Petersen',
  'Seleka', 'Moloi', 'Mahlatsi', 'Rakgotso', 'Sibiya', 'Msimang', 'Nyathi', 'Baloyi',
];

// Real suburbs in real cities, with their actual provinces and postal
// codes. An address that does not exist as described is the first
// thing a verification system should be able to notice.
export const PLACES = [
  { suburb: 'Orlando East', city: 'Soweto', province: 'Gauteng', code: '1804' },
  { suburb: 'Diepkloof', city: 'Soweto', province: 'Gauteng', code: '1862' },
  { suburb: 'Ferndale', city: 'Randburg', province: 'Gauteng', code: '2194' },
  { suburb: 'Fontainebleau', city: 'Randburg', province: 'Gauteng', code: '2194' },
  { suburb: 'Rosebank', city: 'Johannesburg', province: 'Gauteng', code: '2196' },
  { suburb: 'Alexandra', city: 'Johannesburg', province: 'Gauteng', code: '2090' },
  { suburb: 'Florida', city: 'Roodepoort', province: 'Gauteng', code: '1709' },
  { suburb: 'Tembisa', city: 'Kempton Park', province: 'Gauteng', code: '1632' },
  { suburb: 'Van Riebeeck Park', city: 'Kempton Park', province: 'Gauteng', code: '1619' },
  { suburb: 'Halfway House', city: 'Midrand', province: 'Gauteng', code: '1685' },
  { suburb: 'Eldoraigne', city: 'Centurion', province: 'Gauteng', code: '0157' },
  { suburb: 'Sunnyside', city: 'Pretoria', province: 'Gauteng', code: '0002' },
  { suburb: 'Mamelodi', city: 'Pretoria', province: 'Gauteng', code: '0122' },
  { suburb: 'Hatfield', city: 'Pretoria', province: 'Gauteng', code: '0083' },
  { suburb: 'Bapsfontein', city: 'Ekurhuleni', province: 'Gauteng', code: '1510' },
  { suburb: 'Vanderbijlpark CE', city: 'Vanderbijlpark', province: 'Gauteng', code: '1911' },
  { suburb: 'Khayelitsha', city: 'Cape Town', province: 'Western Cape', code: '7784' },
  { suburb: 'Rocklands', city: 'Mitchells Plain', province: 'Western Cape', code: '7785' },
  { suburb: 'Parklands', city: 'Cape Town', province: 'Western Cape', code: '7441' },
  { suburb: 'Bothasig', city: 'Cape Town', province: 'Western Cape', code: '7441' },
  { suburb: 'Bellville', city: 'Cape Town', province: 'Western Cape', code: '7530' },
  { suburb: 'Athlone', city: 'Cape Town', province: 'Western Cape', code: '7764' },
  { suburb: 'Parow', city: 'Cape Town', province: 'Western Cape', code: '7500' },
  { suburb: 'Umlazi K', city: 'Durban', province: 'KwaZulu-Natal', code: '4031' },
  { suburb: 'Chatsworth Unit 3', city: 'Durban', province: 'KwaZulu-Natal', code: '4092' },
  { suburb: 'Phoenix', city: 'Durban', province: 'KwaZulu-Natal', code: '4068' },
  { suburb: 'Westville', city: 'Durban', province: 'KwaZulu-Natal', code: '3629' },
  { suburb: 'Bluff', city: 'Durban', province: 'KwaZulu-Natal', code: '4052' },
  { suburb: 'Pinetown', city: 'Durban', province: 'KwaZulu-Natal', code: '3610' },
  { suburb: 'Motherwell', city: 'Gqeberha', province: 'Eastern Cape', code: '6211' },
  { suburb: 'Newton Park', city: 'Gqeberha', province: 'Eastern Cape', code: '6045' },
  { suburb: 'Mdantsane', city: 'East London', province: 'Eastern Cape', code: '5219' },
  { suburb: 'Heidedal', city: 'Bloemfontein', province: 'Free State', code: '9306' },
  { suburb: 'Bayswater', city: 'Bloemfontein', province: 'Free State', code: '9301' },
  { suburb: 'Central', city: 'Bloemfontein', province: 'Free State', code: '9301' },
  { suburb: 'Seshego', city: 'Polokwane', province: 'Limpopo', code: '0742' },
  { suburb: 'Polokwane Central', city: 'Polokwane', province: 'Limpopo', code: '0699' },
  { suburb: 'Mankweng', city: 'Polokwane', province: 'Limpopo', code: '0727' },
  { suburb: 'KaNyamazane', city: 'Mbombela', province: 'Mpumalanga', code: '1214' },
  { suburb: 'Emalahleni Ext 5', city: 'eMalahleni', province: 'Mpumalanga', code: '1035' },
  { suburb: 'Galeshewe', city: 'Kimberley', province: 'Northern Cape', code: '8345' },
  { suburb: 'Tlhabane', city: 'Rustenburg', province: 'North West', code: '0309' },
  { suburb: 'Mahikeng Central', city: 'Mahikeng', province: 'North West', code: '2745' },
];

export const STREETS = [
  'Protea', 'Ncamu', 'Marine', 'Olienhout', 'Sunbird', 'Duiker', 'Buffelsdoorn', 'Kerk',
  'Church', 'Voortrekker', 'Mandela', 'Sisulu', 'Tambo', 'Biko', 'Bosbok', 'Rietvlei',
  'Kobus', 'Peace', 'Hans van Rensburg', 'Sivewright', 'Sturdee', 'Rabie', 'Sixth',
  'Mangosuthu', 'Main', 'Long', 'Loop', 'Bree', 'Jan Smuts', 'Oxford', 'Rivonia',
];

export const STREET_TYPE = ['Street', 'Avenue', 'Road', 'Close', 'Drive', 'Crescent', 'Straat', 'Laan'];

// Real banks with their real universal branch codes. A branch code
// that does not exist is a thing account verification catches.
export const BANKS = [
  { name: 'Standard Bank', branch: '051001' },
  { name: 'Absa', branch: '632005' },
  { name: 'FNB', branch: '250655' },
  { name: 'Nedbank', branch: '198765' },
  { name: 'Capitec', branch: '470010' },
  { name: 'TymeBank', branch: '678910' },
  { name: 'African Bank', branch: '430000' },
  { name: 'Investec', branch: '580105' },
  { name: 'Discovery Bank', branch: '679000' },
  { name: 'Bidvest Bank', branch: '462005' },
];

export const NETWORKS = ['Vodacom', 'MTN', 'Cell C', 'Telkom', 'Rain'];

export const SECTORS = [
  'Transport', 'Healthcare', 'Retail', 'Manufacturing', 'Construction', 'Agriculture',
  'Education', 'Government', 'Mining', 'Hospitality', 'Financial Services', 'Logistics',
  'Security', 'Services', 'Aviation', 'Legal', 'Telecommunications', 'Energy',
];

export const EMPLOYER_STEMS = [
  'Highveld', 'Atlantic', 'Meridian', 'Sentinel', 'Cascade', 'Summit', 'Northern', 'Coastal',
  'Vaal', 'Drakensberg', 'Karoo', 'Zambezi', 'Umgeni', 'Tugela', 'Orange River', 'Bushveld',
  'Riverside', 'Parkview', 'Goldfields', 'Ironstone', 'Bluewater', 'Silverline', 'Redstone',
  'Aloe', 'Protea', 'Marula', 'Baobab', 'Yellowwood', 'Acacia', 'Fynbos',
];

export const EMPLOYER_TAIL = [
  'Logistics', 'Holdings', 'Services', 'Group', 'Trading', 'Industries', 'Solutions',
  'Distributors', 'Engineering', 'Contractors', 'Administrators', 'Consulting', 'Supplies',
  'Manufacturing', 'Freight', 'Security Services', 'Cleaning Services', 'Catering',
];

export const EMPLOYER_FORM = ['(Pty) Ltd', 'CC', '(Pty) Ltd', '(Pty) Ltd', 'Inc'];

export const JOB_TITLES = [
  'Operations Supervisor', 'Fleet Controller', 'Claims Assessor', 'Accounts Clerk',
  'Practice Manager', 'Assistant Store Manager', 'Team Leader', 'Workshop Foreman',
  'Maintenance Planner', 'Deputy Principal', 'Junior Buyer', 'Actuarial Analyst',
  'Quality Inspector', 'Site Agent', 'Payroll Administrator', 'Sales Representative',
  'Warehouse Supervisor', 'Security Officer', 'Nursing Sister', 'Diesel Mechanic',
  'Financial Accountant', 'Procurement Officer', 'Branch Manager', 'Call Centre Agent',
  'Boilermaker', 'Electrician', 'Plant Operator', 'Debtors Clerk', 'HR Officer',
];

// Vehicles actually sold in South Africa, at money they actually cost.
// A financed asset priced wrongly makes every affordability figure
// downstream of it meaningless.
export const VEHICLES = [
  { make: 'Toyota', model: 'Corolla Cross', variant: '1.8 XS Hybrid', retail: 45990000, type: 'vehicle_passenger' },
  { make: 'Toyota', model: 'Starlet', variant: '1.5 XR Auto', retail: 31990000, type: 'vehicle_passenger' },
  { make: 'Toyota', model: 'Hilux', variant: '2.4 GD-6 SRX', retail: 52990000, type: 'vehicle_commercial' },
  { make: 'Toyota', model: 'Hilux', variant: '2.8 GD-6 Raider 4x4', retail: 78990000, type: 'vehicle_commercial' },
  { make: 'Volkswagen', model: 'Polo Vivo', variant: '1.4 Trendline', retail: 25990000, type: 'vehicle_passenger' },
  { make: 'Volkswagen', model: 'Polo', variant: '1.0 TSI Life', retail: 37990000, type: 'vehicle_passenger' },
  { make: 'Suzuki', model: 'Swift', variant: '1.2 GL AMT', retail: 22990000, type: 'vehicle_passenger' },
  { make: 'Suzuki', model: 'Fronx', variant: '1.5 GLX Auto', retail: 36990000, type: 'vehicle_passenger' },
  { make: 'Hyundai', model: 'Grand i10', variant: '1.0 Motion', retail: 24990000, type: 'vehicle_passenger' },
  { make: 'Hyundai', model: 'i20', variant: '1.2 Motion', retail: 27990000, type: 'vehicle_passenger' },
  { make: 'Kia', model: 'Sonet', variant: '1.5 EX Auto', retail: 36990000, type: 'vehicle_passenger' },
  { make: 'Kia', model: 'Picanto', variant: '1.2 Style', retail: 25990000, type: 'vehicle_passenger' },
  { make: 'Ford', model: 'Ranger', variant: '2.0 SiT Double Cab XL', retail: 57990000, type: 'vehicle_commercial' },
  { make: 'Isuzu', model: 'D-Max', variant: '250 HO Hi-Ride', retail: 52990000, type: 'vehicle_commercial' },
  { make: 'Nissan', model: 'NP200', variant: '1.6i Safety Pack', retail: 24990000, type: 'vehicle_commercial' },
  { make: 'Nissan', model: 'Magnite', variant: '1.0 Acenta', retail: 27990000, type: 'vehicle_passenger' },
  { make: 'Renault', model: 'Kwid', variant: '1.0 Zen', retail: 19990000, type: 'vehicle_passenger' },
  { make: 'Haval', model: 'Jolion', variant: '1.5T City DCT', retail: 37990000, type: 'vehicle_passenger' },
  { make: 'Chery', model: 'Tiggo 4 Pro', variant: '1.5 Comfort', retail: 32990000, type: 'vehicle_passenger' },
  { make: 'Mahindra', model: 'Pik Up', variant: '2.2 mHawk S6 Double Cab', retail: 45990000, type: 'vehicle_commercial' },
  { make: 'Honda', model: 'Amaze', variant: '1.2 Comfort CVT', retail: 28990000, type: 'vehicle_passenger' },
  { make: 'Mazda', model: 'CX-3', variant: '2.0 Active', retail: 39990000, type: 'vehicle_passenger' },
];

export const HANDSETS = [
  { make: 'Samsung', model: 'Galaxy A16 5G', variant: '128 GB', retail: 499900 },
  { make: 'Samsung', model: 'Galaxy A55 5G', variant: '256 GB', retail: 1099900 },
  { make: 'Samsung', model: 'Galaxy S24 FE', variant: '256 GB', retail: 1499900 },
  { make: 'Apple', model: 'iPhone 15', variant: '128 GB', retail: 1899900 },
  { make: 'Apple', model: 'iPhone SE', variant: '128 GB', retail: 999900 },
  { make: 'Xiaomi', model: 'Redmi Note 14', variant: '256 GB', retail: 549900 },
  { make: 'Huawei', model: 'nova 12 SE', variant: '256 GB', retail: 799900 },
  { make: 'Oppo', model: 'A60', variant: '128 GB', retail: 429900 },
];

export const OTHER_ASSETS = [
  { make: 'Sunsynk', model: '5kW Hybrid Inverter', variant: 'with 5.12 kWh battery', retail: 8900000, type: 'solar_system' },
  { make: 'Deye', model: '8kW Hybrid Inverter', variant: 'with 10.24 kWh battery', retail: 17400000, type: 'solar_system' },
  { make: 'HP', model: '250 G10', variant: 'i5 / 16GB / 512GB', retail: 1199900, type: 'laptop' },
  { make: 'Lenovo', model: 'IdeaPad Slim 3', variant: 'Ryzen 5 / 8GB', retail: 999900, type: 'laptop' },
  { make: 'Samsung', model: 'Galaxy Tab A9+', variant: '128 GB LTE', retail: 599900, type: 'tablet' },
];

export const COLOURS = [
  'Silver Metallic', 'Arctic White', 'Graphite Grey', 'Reef Blue', 'Burning Red',
  'Polar White', 'Obsidian Grey', 'Carbon Black', 'Ayers Grey', 'Lunar Silver',
  'Chromium Silver', 'Napoli Black', 'Candy White', 'Titan Grey', 'Ice Blue',
];

export const CREDITORS = [
  'Standard Bank', 'Absa Home Loans', 'Woolworths Financial Services', 'Edgars Account',
  'TFG Money', 'MTN Postpaid', 'Nedbank Vehicle Finance', 'Capitec Credit',
  'African Bank Personal Loan', 'FNB Credit Card', 'Vodacom Postpaid', 'Makro Card',
  'Truworths', 'JD Group', 'Bidvest Insurance Premium', 'Old Mutual Finance',
];

export const ACCOUNT_TYPES = [
  'credit_card', 'instalment', 'revolving', 'clothing', 'telecoms',
  'vehicle_finance', 'personal_loan', 'home_loan', 'overdraft', 'store_card',
];

// The platforms that call the hub. These are the sibling systems, not
// invented ones.
export const PLATFORMS = [
  { id: 'xcentral_console', name: 'xCentral Console', contact: 'ops@xcentral.co.za',
    domains: ['identity', 'document', 'credit', 'biometric'], party: 'xCentral (Pty) Ltd' },
  { id: 'biprapay', name: 'BipraPay', contact: 'compliance@biprapay.com',
    domains: ['identity', 'document', 'biometric'], party: 'BipraPay (Pty) Ltd' },
  { id: 'xpayments', name: 'xPayments', contact: 'risk@xpayments.co.za',
    domains: ['identity', 'document', 'credit', 'biometric'], party: 'xPayments (Pty) Ltd' },
  { id: 'veribills', name: 'veriBills', contact: 'support@veribills.co.za',
    domains: ['identity', 'document'], party: 'veriBills (Pty) Ltd' },
  { id: 'piggybag', name: 'PiggyBag', contact: 'hello@piggybag.co.za',
    domains: ['identity', 'credit'], party: 'PiggyBag (Pty) Ltd' },
  { id: 'mysmme', name: 'mySMME', contact: 'admin@mysmme.co.za',
    domains: ['identity', 'document'], party: 'mySMME (Pty) Ltd' },
];

// Customer-number prefixes, so a reference identifies its platform on
// sight the way a real one does.
export const PREFIX = {
  biprapay: 'BP', xpayments: 'XP', veribills: 'VB',
  piggybag: 'PG', mysmme: 'SM', xcentral_console: 'XC',
};

export const CASE_REF_STEM = {
  biprapay: 'MRC-APP', xpayments: 'LOAN', veribills: 'ACC',
  piggybag: 'PB-APP', mysmme: 'SM-ONB', xcentral_console: 'XC-CASE',
};

// A plain hash, only ever used to stand in for the peppered digests the
// database holds. It is not a security primitive and is not treated as
// one anywhere: nothing is recovered from it, and nothing is
// authenticated by it. It exists so that two records that should
// collide do, and two that should not, do not.
export function tag(prefix, value) {
  let h = 2166136261 >>> 0;
  const s = String(value);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `${prefix}-${h.toString(16).padStart(8, '0')}`;
}

export function uid(random) {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) out += '-';
    out += hex[random.int(0, 15)];
  }
  return out;
}
