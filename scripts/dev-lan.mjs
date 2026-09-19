// ══════════════════════════════════════════════════════════════
// Serves the console over HTTPS on the machine's LAN address, so a
// phone on the same network can open it and use its camera.
//
//   npm run dev:lan
//
// Why this exists at all: getUserMedia is refused outside a secure
// context, and no amount of granting permission changes that.
// localhost counts as secure, which is why the camera works on the
// laptop running the dev server and fails on the phone typing in that
// laptop's 192.168 address. The fix is not a permission — it is TLS.
//
// So this mints a self-signed certificate covering the machine's own
// addresses and hands it to Vite. The phone will warn that the
// certificate is not trusted, because it is not: accept it once and
// the camera works. Nothing here should ever be used to serve
// anything to anyone outside the room.
// ══════════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const ROOT = new URL('..', import.meta.url).pathname;
const CERT_DIR = join(ROOT, '.certs');
const KEY = join(CERT_DIR, 'lan-key.pem');
const CRT = join(CERT_DIR, 'lan-cert.pem');

function addresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    }
  }
  return out;
}

const ips = addresses();
if (!ips.length) {
  console.error('This machine has no non-loopback IPv4 address, so there is nothing for a phone '
    + 'to connect to. Use `npm run dev` on the machine itself.');
  process.exit(2);
}

// The certificate names every address the machine actually has. A
// certificate for "localhost" alone is refused by the phone the moment
// it types in an IP, which is exactly the case this exists for.
if (!existsSync(KEY) || !existsSync(CRT)) {
  mkdirSync(CERT_DIR, { recursive: true });
  const alt = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365',
    '-keyout', KEY, '-out', CRT,
    '-subj', '/CN=xcentral-lan',
    '-addext', `subjectAltName=${alt}`,
  ], { stdio: 'inherit' });
  writeFileSync(join(CERT_DIR, '.gitignore'), '*\n');
  console.log(`\nA self-signed certificate was created for ${alt}.\n`);
}

const server = await createServer({
  root: ROOT,
  server: {
    host: true,
    port: 5174,
    https: { key: readFileSync(KEY), cert: readFileSync(CRT) },
  },
});
await server.listen();

console.log('\n  The console is served over HTTPS. On a phone on the same network, open:\n');
for (const ip of ips) console.log(`    https://${ip}:5174`);
console.log('\n  The certificate is self-signed, so the phone will warn once. Accept it — the');
console.log('  camera and the depth scan need a secure context and will not run without one.\n');
