// ══════════════════════════════════════════════════════════════
// A deliberately small stand-in for Supabase's REST layer, so the
// console can be driven against a real seeded Postgres without a
// Supabase project.
//
// This is a TEST HARNESS, not a Supabase implementation. It speaks
// exactly the subset of PostgREST that src/backend.js uses and
// nothing else:
//
//   GET  /rest/v1/<table>?select=*&<col>=eq.<v>&order=<col>.<dir>&limit=<n>
//   POST /rest/v1/rpc/<function>          named arguments as JSON
//   GET  /auth/v1/user                    always 401, nobody is signed in
//   POST /functions/v1/<name>             always 501, edge functions are Deno
//
// Anything outside that subset returns 501 rather than guessing. That
// matters: a shim that silently answers a query it does not really
// understand would make a passing test meaningless. If backend.js
// grows a filter this does not implement, the console test fails
// loudly and this file gets extended on purpose.
//
// Static files are served from dist/ off the same origin, so the
// browser sees one host and there is no CORS to arrange.
// ══════════════════════════════════════════════════════════════

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import pg from 'pg';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

// Only the operators backend.js actually uses. Everything else is a
// 501, on purpose — see the header.
function buildFilter(column, spec, params) {
  const dot = spec.indexOf('.');
  const op = dot === -1 ? spec : spec.slice(0, dot);
  const raw = dot === -1 ? '' : spec.slice(dot + 1);
  const col = `"${column.replace(/"/g, '""')}"`;

  switch (op) {
    case 'eq':
      params.push(raw);
      return `${col}::text = $${params.length}`;
    case 'neq':
      params.push(raw);
      return `${col}::text is distinct from $${params.length}`;
    case 'is':
      if (raw === 'null') return `${col} is null`;
      if (raw === 'true' || raw === 'false') return `${col} is ${raw}`;
      throw new Unsupported(`is.${raw}`);
    case 'in': {
      const inner = raw.replace(/^\(/, '').replace(/\)$/, '');
      const values = inner
        ? inner.split(',').map((v) => v.replace(/^"(.*)"$/, '$1'))
        : [];
      params.push(values);
      return `${col}::text = any($${params.length}::text[])`;
    }
    default:
      throw new Unsupported(`operator ${op}`);
  }
}

class Unsupported extends Error {}

function buildOrder(values) {
  // order=col.asc, order=col.desc.nullslast, or a bare column.
  return values
    .flatMap((v) => v.split(','))
    .map((clause) => {
      const [column, ...rest] = clause.split('.');
      const dir = rest.includes('desc') ? 'desc' : 'asc';
      const nulls = rest.includes('nullsfirst')
        ? ' nulls first'
        : rest.includes('nullslast')
          ? ' nulls last'
          : '';
      return `"${column.replace(/"/g, '""')}" ${dir}${nulls}`;
    })
    .join(', ');
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function startShim({ databaseUrl, distDir, port = 0, role = 'authenticated' }) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });

  const queries = [];
  const failures = [];

  // Every query runs as the console's role, so row level security is
  // exercised rather than bypassed. A page that renders here renders
  // because the policies allow it, not because the test is privileged.
  // The role is set and reset around each query on a checked-out
  // client, so a pooled connection never leaks it to the next caller.
  async function run(sql, params) {
    queries.push(sql);
    const client = await pool.connect();
    try {
      await client.query(`set local role ${role}`);
      return await client.query(sql, params);
    } finally {
      client.release();
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'content-type': type });
      // Buffers are file contents and must go out as bytes. Anything
      // else that is not already a string is a JSON response body.
      if (Buffer.isBuffer(body) || typeof body === 'string') res.end(body);
      else res.end(JSON.stringify(body));
    };

    try {
      // ── Nobody is signed in. getProfile() handles this. ──────────
      if (url.pathname.startsWith('/auth/v1/')) {
        return send(401, { message: 'no session' });
      }

      // ── Edge functions are Deno and are not under test here. ─────
      if (url.pathname.startsWith('/functions/v1/')) {
        failures.push(`edge function called: ${url.pathname}`);
        return send(501, { error: 'edge functions are not served by the shim' });
      }

      // ── RPC ──────────────────────────────────────────────────────
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const fn = url.pathname.slice('/rest/v1/rpc/'.length);
        const args = await readBody(req);
        const names = Object.keys(args);
        const params = names.map((n) => args[n]);
        const call = names.length
          ? names.map((n, i) => `"${n}" => $${i + 1}`).join(', ')
          : '';
        const sql = `select public."${fn}"(${call}) as result`;
        const { rows } = await run(sql, params);
        return send(200, rows[0]?.result ?? null);
      }

      // ── Table reads ──────────────────────────────────────────────
      if (url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.slice('/rest/v1/'.length);
        if (req.method !== 'GET') throw new Unsupported(`${req.method} on a table`);

        const select = url.searchParams.get('select');
        if (select && select !== '*') throw new Unsupported(`select=${select}`);

        const params = [];
        const where = [];
        let order = '';
        let limit = '';

        for (const [key, value] of url.searchParams) {
          if (key === 'select') continue;
          if (key === 'order') { order = ` order by ${buildOrder([value])}`; continue; }
          if (key === 'limit') { limit = ` limit ${Number(value) || 0}`; continue; }
          if (key === 'offset') { limit += ` offset ${Number(value) || 0}`; continue; }
          if (key.startsWith('_')) continue;
          where.push(buildFilter(key, value, params));
        }

        const sql = `select * from public."${table}"`
          + (where.length ? ` where ${where.join(' and ')}` : '')
          + order + limit;

        const { rows } = await run(sql, params);

        // .single() / .maybeSingle() ask for the object form.
        const accept = req.headers.accept ?? '';
        if (accept.includes('pgrst.object+json')) {
          if (rows.length === 1) return send(200, rows[0]);
          return send(406, {
            code: 'PGRST116',
            message: `expected one row, found ${rows.length}`,
          });
        }
        return send(200, rows);
      }

      // ── Static files from dist/ ──────────────────────────────────
      const rel = url.pathname === '/' ? '/index.html' : url.pathname;
      const path = join(distDir, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
      const body = await readFile(path);
      return send(200, body, MIME[extname(path)] ?? 'application/octet-stream');
    } catch (e) {
      if (e instanceof Unsupported) {
        // Loud on purpose. See the header.
        failures.push(`unsupported by the shim: ${e.message} (${req.url})`);
        return send(501, { error: `shim does not implement ${e.message}` });
      }
      if (e.code === 'ENOENT') return send(404, 'not found', 'text/plain');
      failures.push(`${req.url} → ${e.message}`);
      return send(500, { message: e.message });
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    queries,
    failures,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}
