const pool = require('../db');
const { hmac } = require('./security-crypto');

function ipHash(req) {
    return req?.ip ? hmac(req.ip) : null;
}

function cleanMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return null;
    const blocked = /token|secret|senha|password|authorization|cookie|totp/i;
    const out = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (blocked.test(key)) continue;
        if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) out[key] = value;
    }
    return Object.keys(out).length ? out : null;
}

async function audit(req, eventType, { actorType = null, actorId = null, targetType = null, targetId = null, outcome = 'success', metadata = null } = {}) {
    try {
        await pool.query(
            `INSERT INTO portal_audit_events
             (event_type, actor_type, actor_id, target_type, target_id, outcome, ip_hash, user_agent, metadata_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                String(eventType).slice(0, 80),
                actorType ? String(actorType).slice(0, 32) : null,
                actorId ? String(actorId).slice(0, 128) : null,
                targetType ? String(targetType).slice(0, 64) : null,
                targetId ? String(targetId).slice(0, 128) : null,
                String(outcome).slice(0, 32),
                ipHash(req),
                String(req?.headers?.['user-agent'] || '').slice(0, 255) || null,
                cleanMetadata(metadata) ? JSON.stringify(cleanMetadata(metadata)) : null
            ]
        );
    } catch (error) {
        console.warn('[AUDIT] Falha ao registrar evento:', error.message);
    }
}

module.exports = { audit, ipHash };
