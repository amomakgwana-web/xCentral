// ══════════════════════════════════════════════════════════════
// Retention enforcement.
//
// POPIA s14 says personal information may not be kept longer than
// necessary. A retention policy nobody executes is not a policy, so
// this runs on a schedule and actually deletes.
//
// What it does:
//   · deletes document objects from storage past retention, and
//     blanks the path while keeping the metadata row — the fact that
//     a document was verified is part of the audit record even after
//     the image is gone;
//   · deactivates biometric templates past retention or whose
//     consent has lapsed, since a template kept alive after its
//     consent expired is exactly the thing POPIA prohibits;
//   · expires verification cases past their validity;
//   · clears spent idempotency keys.
//
// It reports what it did rather than running silently, and supports
// a dry run so the first execution against real data can be inspected
// before anything is destroyed.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson } from '../_shared/http.ts';
import { adminClient, audit } from '../_shared/auth.ts';

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  const expected = Deno.env.get('RETENTION_PURGE_SECRET');
  if (!expected) return json({ error: 'RETENTION_PURGE_SECRET is not configured' }, 500);
  if (req.headers.get('x-purge-secret') !== expected) return json({ error: 'Not authorised' }, 401);

  const [body] = await readJson(req.method === 'POST' ? req : new Request(req.url, { method: 'POST', body: '{}' }));
  const dryRun = body?.dryRun !== false;

  const admin = adminClient();
  const now = new Date().toISOString();
  const report: Record<string, unknown> = { dryRun, at: now };

  try {
    // ── Documents past retention ─────────────────────────────────
    const { data: staleDocs } = await admin
      .from('documents')
      .select('id, storage_path, retention_until, case_id')
      .lt('retention_until', now)
      .is('purged_at', null)
      .limit(500);

    report.documentsDue = staleDocs?.length ?? 0;

    if (!dryRun && staleDocs?.length) {
      const paths = staleDocs.map((d) => d.storage_path).filter(Boolean);
      if (paths.length) {
        const { error: rmErr } = await admin.storage.from('verification-documents').remove(paths);
        // A storage failure must not mark the row purged — otherwise
        // the object is orphaned and never retried.
        if (rmErr) {
          report.storageError = rmErr.message;
        } else {
          await admin.from('documents')
            .update({ purged_at: now, storage_path: '' })
            .in('id', staleDocs.map((d) => d.id));
          report.documentsPurged = staleDocs.length;
        }
      }
    }

    // ── Biometric templates past retention ───────────────────────
    const { data: staleTemplates } = await admin
      .from('biometric_templates')
      .select('id, subject_id, retention_until')
      .lt('retention_until', now)
      .eq('active', true)
      .limit(500);

    report.templatesPastRetention = staleTemplates?.length ?? 0;

    if (!dryRun && staleTemplates?.length) {
      await admin.from('biometric_templates')
        .update({ active: false })
        .in('id', staleTemplates.map((t) => t.id));
      report.templatesDeactivated = staleTemplates.length;
    }

    // ── Templates whose consent has lapsed ───────────────────────
    // Checked separately because a template can be well inside its
    // retention window and still have lost its lawful basis.
    const { data: activeTemplates } = await admin
      .from('biometric_templates')
      .select('id, subject_id')
      .eq('active', true)
      .limit(1000);

    const orphaned: string[] = [];
    for (const t of activeTemplates ?? []) {
      const { data: consented } = await admin.rpc('has_active_consent', {
        p_subject_id: t.subject_id, p_purpose: 'biometric_processing',
      });
      if (!consented) orphaned.push(t.id);
    }

    report.templatesWithoutConsent = orphaned.length;

    if (!dryRun && orphaned.length) {
      await admin.from('biometric_templates').update({ active: false }).in('id', orphaned);
      report.templatesRevoked = orphaned.length;
    }

    // ── Cases past validity ──────────────────────────────────────
    const { data: expiredCases } = await admin
      .from('verification_cases')
      .select('id')
      .lt('expires_at', now)
      .eq('status', 'verified')
      .limit(500);

    report.casesExpiring = expiredCases?.length ?? 0;

    if (!dryRun && expiredCases?.length) {
      await admin.from('verification_cases')
        .update({ status: 'expired' })
        .in('id', expiredCases.map((c) => c.id));

      // A subject whose only verified case has expired drops back to
      // no standing assurance.
      await admin.from('subjects')
        .update({ assurance_level: 'none', assurance_expires_at: null })
        .lt('assurance_expires_at', now);

      report.casesExpired = expiredCases.length;
    }

    // ── Spent idempotency keys ───────────────────────────────────
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 7);
    if (!dryRun) {
      const { data: removed } = await admin
        .from('idempotency_keys').delete().lt('created_at', cutoff.toISOString()).select('key');
      report.idempotencyKeysCleared = removed?.length ?? 0;
    }

    if (!dryRun) {
      await audit(admin, {
        action: 'retention.purge',
        entityType: 'system',
        entityId: null,
        metadata: report,
      });
    }

    return json(report);
  } catch (e) {
    console.error('retention-purge failed', e);
    return json({ error: e instanceof Error ? e.message : 'Purge failed', report }, 500);
  }
});
