// Tests for the MRZ parser, using the specimen documents published in
// ICAO Doc 9303 (Anna Maria Eriksson, Utopia). Run with:
//
//   node --experimental-strip-types supabase/functions/_shared/mrz.test.ts
//
// The parser is plain TypeScript with no Deno APIs, so it runs the
// same under Node as it does in the edge runtime.

import { parseMrz, checkDigit } from './mrz.ts';

let failures = 0;
function expect(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.log(`FAIL  ${label}\n      expected ${JSON.stringify(want)}\n      got      ${JSON.stringify(got)}`); }
  else console.log(`pass  ${label}`);
}

// ── Check digit arithmetic (ICAO 9303 Part 3, 7-3-1 weighting) ──
expect('check digit of a document number', checkDigit('L898902C3'), 6);
expect('check digit of a date of birth', checkDigit('740812'), 2);
expect('check digit of an expiry date', checkDigit('120415'), 9);
expect('an unusable character yields null', checkDigit('ABC*123'), null);

// ── TD3 passport specimen ───────────────────────────────────────
const td3 = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
].join('\n');

const r3 = parseMrz(td3);
expect('TD3 specimen is recognised', r3.format, 'TD3');
expect('TD3 specimen validates', r3.valid, true);
expect('  · every check digit passes', Object.values(r3.checkDigits).every(Boolean), true);
expect('  · surname parsed', r3.fields.surname, 'ERIKSSON');
expect('  · given names parsed', r3.fields.given_names, 'ANNA MARIA');
expect('  · document number parsed', r3.fields.document_number, 'L898902C3');
expect('  · issuing state parsed', r3.fields.issuing_state, 'UTO');
expect('  · date of birth resolved to last century', r3.fields.date_of_birth, '1974-08-12');
expect('  · expiry date resolved', r3.fields.date_of_expiry, '2012-04-15');
expect('  · sex parsed', r3.fields.sex, 'female');

// A single altered digit in the document number must break both that
// field's check digit and the composite.
const tampered = td3.replace('L898902C36', 'L898903C36');
const rt = parseMrz(tampered);
expect('a tampered document number is caught', rt.valid, false);
expect('  · the document-number digit fails', rt.checkDigits.document_number, false);
expect('  · and so does the composite', rt.checkDigits.composite, false);

// Altering a date the same way.
const tamperedDob = td3.replace('7408122', '7508122');
expect('a tampered date of birth is caught', parseMrz(tamperedDob).valid, false);

// ── TD1 identity card specimen ──────────────────────────────────
const td1 = [
  'I<UTOD231458907<<<<<<<<<<<<<<<',
  '7408122F1204159UTO<<<<<<<<<<<6',
  'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
].join('\n');

const r1 = parseMrz(td1);
expect('TD1 specimen is recognised', r1.format, 'TD1');
expect('TD1 specimen validates', r1.valid, true);
expect('  · every check digit passes', Object.values(r1.checkDigits).every(Boolean), true);
expect('  · surname parsed', r1.fields.surname, 'ERIKSSON');
expect('  · given names parsed', r1.fields.given_names, 'ANNA MARIA');
expect('  · document number parsed', r1.fields.document_number, 'D23145890');
expect('  · date of birth resolved', r1.fields.date_of_birth, '1974-08-12');
expect('  · expiry date resolved', r1.fields.date_of_expiry, '2012-04-15');

// ── Malformed input ─────────────────────────────────────────────
expect('a short line is not a valid MRZ', parseMrz('NOT AN MRZ').format, 'unknown');
expect('empty input is not a valid MRZ', parseMrz('').valid, false);
expect('  · with a reason code', parseMrz('').reasonCodes[0], 'mrz_format_unrecognised');

console.log(failures === 0
  ? '\n───────────────  ALL MRZ TESTS PASSED  ───────────────'
  : `\n${failures} MRZ TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
