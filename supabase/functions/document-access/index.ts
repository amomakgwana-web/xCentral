// ══════════════════════════════════════════════════════════════
// The only way to look at a stored document.
//
// The bucket is private and carries no client policy, so a staff
// member cannot fetch an ID scan by URL even with a valid session.
// They come here, the permission is checked, the access is logged,
// and a signed URL is minted with a short life.
//
// Logging the access is the point as much as gating it: "who looked
// at this person's ID, and when" is a question POPIA expects a
// responsible party to be able to answer.
// ══════════════════════════════════════════════════════════════

import { json, preflight, readJson, clientIp } from '../_shared/http.ts';
import { requireStaff, audit } from '../_shared/auth.ts';

const MAX_TTL_SECONDS = 300;

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const [body, bad] = await readJson(req);
  if (bad) return bad;

  const [staff, denied] = await requireStaff(req, 'documents');
  if (denied) return denied;

  const { documentId, reason, ttlSeconds = 120 } = body ?? {};
  if (!documentId) return json({ error: 'documentId is required' }, 400);

  // A reason is required. It costs the operator a sentence and gives
  // the audit trail something a reviewer can actually assess.
  if (!reason || String(reason).trim().length < 3) {
    return json({ error: 'A reason for accessing this document is required' }, 400);
  }

  const ttl = Math.min(Number(ttlSeconds) || 120, MAX_TTL_SECONDS);
  const admin = staff.admin;

  try {
    const { data: doc } = await admin
      .from('documents')
      .select('id, case_id, subject_id, doc_type, storage_path, purged_at, retention_until')
      .eq('id', documentId)
      .maybeSingle();

    if (!doc) return json({ error: `Document ${documentId} not found` }, 404);
    if (doc.purged_at) {
      return json({
        error: 'That document was purged under the retention policy and no longer exists',
        purgedAt: doc.purged_at,
      }, 410);
    }

    const { data: signed, error } = await admin.storage
      .from('verification-documents')
      .createSignedUrl(doc.storage_path, ttl);

    if (error) return json({ error: `Could not mint a signed URL: ${error.message}` }, 500);

    await audit(admin, {
      actorId: staff.userId,
      action: 'document.accessed',
      entityType: 'document',
      entityId: doc.id,
      metadata: {
        case_id: doc.case_id, subject_id: doc.subject_id, doc_type: doc.doc_type,
        reason: String(reason).slice(0, 500), ttl_seconds: ttl, ip: clientIp(req),
      },
    });

    return json({
      documentId: doc.id,
      docType: doc.doc_type,
      url: signed.signedUrl,
      expiresInSeconds: ttl,
      retentionUntil: doc.retention_until,
    });
  } catch (e) {
    console.error('document-access failed', e);
    return json({ error: e instanceof Error ? e.message : 'Document access failed' }, 500);
  }
});
