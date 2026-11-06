'use strict';
const { hash, canonical } = require('./protocol');
// Audit codes that need a person. A code nobody listed counts as attention, so a new failure is not hidden.
const SECTIONS = Object.freeze({
    reversals: ['PAYMENT_REVERSAL_REVIEW'],
    uncertainDeliveries: ['DELIVERY_UNCERTAIN', 'ORPHANED_DISPATCH', 'SMTP_LEASE_UNCERTAIN', 'HTTP_UNCERTAIN', 'LEASE_RECONCILIATION_REQUIRED'],
    held: ['PAYMENT_DATA_INCONSISTENT', 'DOCUMENT_HELD', 'RECONCILIATION_REQUIRED', 'BOLETO_VERSION_REVIEW', 'BOLETO_VERSION_INCOMPLETE', 'NFSE_REPLACED_REVIEW', 'INSTALLMENT_AMOUNT_MISSING', 'RECIPIENT_UNAUTHORIZED', 'RECIPIENT_INVALID']
});
const ROUTINE = new Set(['QUEUED', 'HTTP_ATTEMPT', 'SMTP_LEASE', 'SENT', 'ALREADY_SENT', 'BASELINE_COMPLETE', 'GENERAL_MODE_ACTIVATED', 'GENERAL_MODE_REVOKED', 'STATE_CHANGED', 'COLLECTION_STOPPED', 'OUTSIDE_SEND_WINDOW',
    'REMINDER_CONSOLIDATED', 'BOLETO_VERSION_CHANGED', 'CLIENT_NOT_RELEASED', 'OBSOLETE', 'EVENT_OBSOLETE', 'DISPATCH_REQUIRED', 'RATE_LIMIT', 'BUSY', 'HTTP_TRANSPORT',
    'PORTAL_VALIDATION_FAILED', 'DISABLED', 'OPERATIONAL_ALERT_UNDELIVERED']);
const WINDOW_HOURS = 25, LIMIT = 500;
function sectionOf(code) {
    for (const [name, codes] of Object.entries(SECTIONS)) if (codes.includes(code)) return name;
    return ROUTINE.has(code) ? null : 'errors';
}
// Reads counts, ids and codes only. Encrypted payloads stay encrypted, so no address or value can appear.
async function buildReport(connection, now = Date.now(), hours = WINDOW_HOURS) {
    const since = now - hours * 3600000;
    await connection.query('START TRANSACTION READ ONLY');
    try {
        const [meta] = await connection.query("SELECT id FROM portal_billing_meta WHERE id = 'baseline'");
        const [counts] = await connection.query('SELECT status, COUNT(*) AS total FROM portal_billing_outbox GROUP BY status');
        const [open] = await connection.query("SELECT id, invoice_id, status FROM portal_billing_outbox WHERE status IN ('uncertain', 'blocked') ORDER BY id LIMIT ?", [LIMIT]);
        const [stuck] = await connection.query("SELECT id, invoice_id, status FROM portal_billing_outbox WHERE status = 'sending' AND next_at < ? ORDER BY id LIMIT ?", [now, LIMIT]);
        const [rows] = await connection.query('SELECT code, subject, COUNT(*) AS total, MAX(at_ms) AS last_at FROM portal_billing_audit WHERE at_ms >= ? GROUP BY code, subject ORDER BY code, subject LIMIT ?', [since, LIMIT]);
        const [general] = await connection.query("SELECT code, MAX(at_ms) AS last_at FROM portal_billing_audit WHERE subject = 'general-mode' GROUP BY code");
        const lastGeneral = name => Number(general.find(r => r.code === name)?.last_at) || null;
        const activated = lastGeneral('GENERAL_MODE_ACTIVATED'), revoked = lastGeneral('GENERAL_MODE_REVOKED');
        const sections = { reversals: [], uncertainDeliveries: [], held: [], errors: [] };
        for (const row of rows) {
            const name = sectionOf(row.code);
            if (name) sections[name].push({ code: row.code, subject: row.subject, count: Number(row.total), lastAt: Number(row.last_at) });
        }
        const body = {
            generatedAt: now, windowHours: hours, baselineComplete: meta.length > 0,
            generalMode: { active: !!activated && (!revoked || revoked < activated), lastActivatedAt: activated, lastRevokedAt: revoked },
            outbox: Object.fromEntries(counts.map(r => [r.status, Number(r.total)])),
            openEvents: open.map(r => ({ eventId: r.id, invoiceId: r.invoice_id, status: r.status })),
            stuckEvents: stuck.map(r => ({ eventId: r.id, invoiceId: r.invoice_id, status: r.status })),
            sections,
            truncated: open.length === LIMIT || stuck.length === LIMIT || rows.length === LIMIT,
            // This report is not an alert: it only counts once someone has read it.
            alertDelivered: false
        };
        body.attention = !body.baselineComplete || body.truncated || open.length > 0 || stuck.length > 0 || Object.values(sections).some(list => list.length > 0);
        return { ...body, digest: hash(canonical(body)) };
    } finally { await connection.query('ROLLBACK'); }
}
module.exports = { buildReport, sectionOf, WINDOW_HOURS };
