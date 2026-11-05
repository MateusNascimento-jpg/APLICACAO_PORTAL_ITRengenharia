'use strict';
// Exact client record ids. Empty means nobody; any other format stops the boot, so nothing is guessed.
function pilotClients(value) {
    const text = String(value || '').trim();
    if (!text) return [];
    const ids = text.split(',').map(id => id.trim());
    if (ids.some(id => !/^rec[A-Za-z0-9]{14}$/.test(id)) || new Set(ids).size !== ids.length) throw new Error('BILLING_PILOT_INVALID');
    return ids;
}
function configuration(env = process.env) {
    for (const flag of ['PORTAL_BILLING_ENABLED', 'PORTAL_BILLING_WORKER_ENABLED'])
        if (!['true', 'false'].includes(env[flag] || 'false')) throw new Error('BILLING_FLAG_INVALID');
    if (env.PORTAL_BILLING_ENABLED !== 'true') return { enabled: false, worker: false };
    const secret = env.BILLING_HMAC_SECRET || '';
    const storageKey = env.PORTAL_BILLING_STORAGE_KEY || '';
    for (const key of [secret, storageKey])
        if (Buffer.from(key, 'base64').length < 32 || Buffer.from(key, 'base64').toString('base64') !== key)
            throw new Error('BILLING_KEY_INVALID');
    if (secret === storageKey) throw new Error('BILLING_KEYS_MUST_DIFFER');
    const origin = new URL(env.PORTAL_BILLING_NOTIFICATIONS_ORIGIN);
    if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash)
        throw new Error('BILLING_ORIGIN_INVALID');
    // Avoid simultaneous fiscal ownership without touching the homologated legacy flag.
    if (env.PORTAL_NF_NOTIFICACOES_ATIVAS === 'true') throw new Error('BILLING_LEGACY_NF_CONFLICT');
    const scanSeconds = Number(env.PORTAL_BILLING_SCAN_INTERVAL_SECONDS || 300);
    if (!Number.isInteger(scanSeconds) || scanSeconds < 60 || scanSeconds > 3600) throw new Error('BILLING_SCAN_INTERVAL_INVALID');
    return { enabled: true, worker: env.PORTAL_BILLING_WORKER_ENABLED === 'true', secret, storageKey, origin: origin.origin, scanIntervalMs: scanSeconds * 1000, pilotClients: pilotClients(env.PORTAL_BILLING_PILOT_CLIENTS) };
}
module.exports = { configuration };
