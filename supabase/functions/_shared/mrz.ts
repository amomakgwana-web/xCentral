// ══════════════════════════════════════════════════════════════
// ICAO 9303 machine-readable zone parsing.
//
// This is the part of document verification that is genuinely
// decidable without a provider: the MRZ carries its own check digits,
// so a transcription error, a fabricated number, or a mismatch
// between the printed date and the encoded one is detectable
// arithmetically. It does not prove the document is genuine — only
// that its machine-readable zone is internally consistent.
//
// Supported: TD3 (passports, 2×44) and TD1 (ID cards, 3×30).
// ══════════════════════════════════════════════════════════════

export interface MrzResult {
  format: 'TD1' | 'TD3' | 'unknown';
  valid: boolean;
  fields: Record<string, unknown>;
  checkDigits: Record<string, boolean>;
  reasonCodes: string[];
}

// Character values for the 7-3-1 weighting: digits are themselves,
// letters are A=10 … Z=35, and the filler '<' is zero.
function charValue(c: string): number {
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55;
  if (c === '<') return 0;
  return -1;
}

export function checkDigit(input: string): number | null {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    const v = charValue(input[i]);
    if (v < 0) return null;
    sum += v * weights[i % 3];
  }
  return sum % 10;
}

function verify(field: string, expected: string): boolean {
  const cd = checkDigit(field);
  if (cd === null) return false;
  // A filler in the check-digit position means the field is unused.
  if (expected === '<') return field.split('').every((c) => c === '<');
  if (!/^[0-9]$/.test(expected)) return false;
  return cd === Number(expected);
}

// YYMMDD from an MRZ has no century. Dates of birth cannot be in the
// future; expiry dates generally are — so the two resolve differently.
function mrzDate(yymmdd: string, kind: 'birth' | 'expiry'): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  const nowYear = new Date().getUTCFullYear();
  let year: number;
  if (kind === 'birth') {
    year = 2000 + yy;
    if (year > nowYear) year = 1900 + yy;
  } else {
    // An expiry more than ~70 years out is really a past century.
    year = 2000 + yy;
    if (year > nowYear + 70) year = 1900 + yy;
  }

  const d = new Date(Date.UTC(year, mm - 1, dd));
  if (d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
  return d.toISOString().slice(0, 10);
}

function names(raw: string): { surname: string; givenNames: string } {
  const [surnamePart, givenPart = ''] = raw.split('<<');
  const clean = (s: string) => s.replace(/</g, ' ').replace(/\s+/g, ' ').trim();
  return { surname: clean(surnamePart), givenNames: clean(givenPart) };
}

function sex(c: string): string {
  return c === 'M' ? 'male' : c === 'F' ? 'female' : 'unknown';
}

export function parseMrz(raw: string): MrzResult {
  const lines = String(raw ?? '')
    .toUpperCase()
    .split(/\r?\n/)
    .map((l) => l.replace(/\s/g, ''))
    .filter((l) => l.length > 0);

  if (lines.length === 2 && lines.every((l) => l.length === 44)) return parseTd3(lines);
  if (lines.length === 3 && lines.every((l) => l.length === 30)) return parseTd1(lines);

  return {
    format: 'unknown',
    valid: false,
    fields: {},
    checkDigits: {},
    reasonCodes: ['mrz_format_unrecognised'],
  };
}

function parseTd3(lines: string[]): MrzResult {
  const [l1, l2] = lines;
  const reasonCodes: string[] = [];

  const documentNumber = l2.slice(0, 9);
  const docCd = l2[9];
  const nationality = l2.slice(10, 13);
  const birth = l2.slice(13, 19);
  const birthCd = l2[19];
  const sexChar = l2[20];
  const expiry = l2.slice(21, 27);
  const expiryCd = l2[27];
  const optional = l2.slice(28, 42);
  const optionalCd = l2[42];
  const compositeCd = l2[43];

  const checkDigits: Record<string, boolean> = {
    document_number: verify(documentNumber, docCd),
    date_of_birth: verify(birth, birthCd),
    date_of_expiry: verify(expiry, expiryCd),
    optional_data: verify(optional, optionalCd),
    // The composite digit covers the document number, both dates and
    // the optional field together, each with its own check digit.
    composite: verify(
      l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43),
      compositeCd,
    ),
  };

  for (const [field, ok] of Object.entries(checkDigits)) {
    if (!ok) reasonCodes.push(`mrz_check_digit_failed_${field}`);
  }

  const dob = mrzDate(birth, 'birth');
  const doe = mrzDate(expiry, 'expiry');
  if (!dob) reasonCodes.push('mrz_date_of_birth_invalid');
  if (!doe) reasonCodes.push('mrz_date_of_expiry_invalid');

  const { surname, givenNames } = names(l1.slice(5));

  return {
    format: 'TD3',
    valid: reasonCodes.length === 0,
    fields: {
      document_code: l1.slice(0, 2).replace(/</g, ''),
      issuing_state: l1.slice(2, 5).replace(/</g, ''),
      surname,
      given_names: givenNames,
      document_number: documentNumber.replace(/</g, ''),
      nationality: nationality.replace(/</g, ''),
      date_of_birth: dob,
      sex: sex(sexChar),
      date_of_expiry: doe,
      optional_data: optional.replace(/</g, ''),
    },
    checkDigits,
    reasonCodes,
  };
}

function parseTd1(lines: string[]): MrzResult {
  const [l1, l2, l3] = lines;
  const reasonCodes: string[] = [];

  const documentNumber = l1.slice(5, 14);
  const docCd = l1[14];
  const birth = l2.slice(0, 6);
  const birthCd = l2[6];
  const sexChar = l2[7];
  const expiry = l2.slice(8, 14);
  const expiryCd = l2[14];
  const nationality = l2.slice(15, 18);
  const compositeCd = l2[29];

  const checkDigits: Record<string, boolean> = {
    document_number: verify(documentNumber, docCd),
    date_of_birth: verify(birth, birthCd),
    date_of_expiry: verify(expiry, expiryCd),
    // TD1's composite runs over the tail of line 1 and three spans of line 2.
    composite: verify(
      l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29),
      compositeCd,
    ),
  };

  for (const [field, ok] of Object.entries(checkDigits)) {
    if (!ok) reasonCodes.push(`mrz_check_digit_failed_${field}`);
  }

  const dob = mrzDate(birth, 'birth');
  const doe = mrzDate(expiry, 'expiry');
  if (!dob) reasonCodes.push('mrz_date_of_birth_invalid');
  if (!doe) reasonCodes.push('mrz_date_of_expiry_invalid');

  const { surname, givenNames } = names(l3);

  return {
    format: 'TD1',
    valid: reasonCodes.length === 0,
    fields: {
      document_code: l1.slice(0, 2).replace(/</g, ''),
      issuing_state: l1.slice(2, 5).replace(/</g, ''),
      surname,
      given_names: givenNames,
      document_number: documentNumber.replace(/</g, ''),
      nationality: nationality.replace(/</g, ''),
      date_of_birth: dob,
      sex: sex(sexChar),
      date_of_expiry: doe,
      optional_data: (l1.slice(15, 30) + l2.slice(18, 29)).replace(/</g, ''),
    },
    checkDigits,
    reasonCodes,
  };
}
