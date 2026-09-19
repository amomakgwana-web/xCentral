// ══════════════════════════════════════════════════════════════
// Folds the flattened build into one HTML file that opens from disk.
//
//   npm run build:single   →   xcentral-console.html
//
// Everything the console needs travels inside that file: the styles,
// the script, the favicon and the whole generated dataset. There is no
// server, no build step and no network call on the path to a rendered
// page — open it and it works, on a laptop with the wifi off.
//
// The one thing left outside is the typeface, which is requested from
// Google Fonts. That request is allowed to fail: every family in the
// stylesheet names real system fallbacks after it, so an offline
// machine renders in Helvetica or Arial rather than rendering nothing.
// ══════════════════════════════════════════════════════════════

import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const BUILD = join(ROOT, 'dist-single');

const html = await readFile(join(BUILD, 'index.html'), 'utf8');
const js = await readFile(join(BUILD, 'app.js'), 'utf8');
const favicon = await readFile(join(ROOT, 'public/favicon.svg'), 'utf8');

// A script element ends at the first `</script>` in its text, wherever
// that appears — including inside a JavaScript string. The dataset
// carries HTML in a few places, so this is a real hazard rather than a
// theoretical one.
const inlined = js.replace(/<\/script>/gi, '<\\/script>');

let out = html
  // The build emits a module tag in the head pointing at app.js. Drop
  // it: a classic script has no import to resolve, which is the whole
  // point of this variant.
  .replace(/\s*<script[^>]*src="[^"]*app\.js"[^>]*><\/script>/, '')
  // Then put the code at the end of the body rather than where the tag
  // was. A module script is deferred by definition and runs after the
  // document is parsed; a classic script in the head runs immediately,
  // and the console's first act is to write into elements that do not
  // exist yet. Inlining in place boots the page into its own
  // "did not start" panel.
  //
  // The replacement is a function, not a template string. A `$&` or
  // `$'` anywhere in the bundle — and minified regex code is full of
  // them — would otherwise be read as a substitution pattern.
  .replace(/<\/body>/, () => `<script>\n${inlined}\n</script>\n</body>`)
  // The icon is a five-line SVG. Carrying it as a data URI saves the
  // only other file the page would need.
  .replace(/<link rel="icon"[^>]*>/,
           () => `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${
             Buffer.from(favicon).toString('base64')}">`);

if (out.includes('src="') && /<script[^>]+src="[^"]*\.js"/.test(out)) {
  console.error('A script tag still points at a file. The build is not self-contained.');
  process.exit(1);
}

// Say what this file is and when it was built, in the file itself.
// Someone who finds it on a shared drive in six weeks should not have
// to guess.
out = out.replace(/<head>/,
  `<head>\n<!-- xCentral Verification Hub — single-file build, ${
    new Date().toISOString().slice(0, 10)}.\n`
  + '     Open this file in a browser. Nothing else is required.\n'
  + '     Records are generated in the page from a fixed seed, so every\n'
  + '     copy of this file shows the same portfolio. -->');

const target = join(ROOT, 'xcentral-console.html');
await writeFile(target, out);
await rm(BUILD, { recursive: true, force: true });

const mb = (Buffer.byteLength(out) / 1024 / 1024).toFixed(2);
console.log(`xcentral-console.html  ${mb} MB  ·  one file, opens from disk`);
