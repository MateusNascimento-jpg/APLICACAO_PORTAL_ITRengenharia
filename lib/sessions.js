const pool = require('../db');
const config = require('../config');
const { randomToken, sha256, hmac, safeEqualHex } = require('./security-crypto');

function cookieOptions(req, maxAgeMs) {
    const secure = config.production || Boolean(req.secure);
    return {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
        maxAge: maxAgeMs
    };
}

function parseCookies(req) {
    const header = String(req.headers.cookie || '');
    const result = {};
    header.split(';').forEach(part => {
        const idx = part.indexOf('=');
        if (idx < 0) return;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (!key) return;
        try { result[key] = decodeURIComponent(value); } catch (_) { result[key] = value; }
    });
    return result;
}

function getRawSessionToken(req) {
    return parseCookies(req)[config.security.cookieName] || null;
}

function getSessionHash(req) {
    const raw = getRawSessionToken(req);
    return raw ? sha256(raw) : null;
}

function getTtlMs(role, remember) {
    if (role === 'Director' || role === 'DirectorMfaPending' || role === 'DirectorSetup') {
        if (role !== 'Director') return 10 * 60 * 1000;
        return config.security.directorSessionHours * 60 * 60 * 1000;
    }
    return remember
        ? config.security.rememberDays * 24 * 60 * 60 * 1000
        : config.security.normalSessionHours * 60 * 60 * 1000;
}

async function createSession(req, res, data, { remember = false } = {}) {
    const raw = randomToken(32);
    const csrfRaw = randomToken(24);
    const sessionHash = sha256(raw);
    const csrfHash = sha256(csrfRaw);
    const ttlMs = getTtlMs(data.role, remember);
    const expiresAt = new Date(Date.now() + ttlMs);

    await pool.query(
        `INSERT INTO portal_sessions
         (session_hash, role, airtable_client_id, documento, email, nome_empresa, remember, csrf_hash, ip_hash, user_agent, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            sessionHash,
            data.role,
            data.airtableId || null,
            data.documento || null,
            data.email || null,
            data.nomeEmpresa || null,
            remember ? 1 : 0,
            csrfHash,
            req.ip ? hmac(req.ip) : null,
            String(req.headers['user-agent'] || '').slice(0, 255) || null,
            expiresAt
        ]
    );

    res.cookie(config.security.cookieName, raw, cookieOptions(req, ttlMs));
    return { csrfToken: csrfRaw, expiresAt };
}

async function loadSession(req) {
    const sessionHash = getSessionHash(req);
    if (!sessionHash) return null;

    const [rows] = await pool.query(
        `SELECT session_hash, role, airtable_client_id, documento, email, nome_empresa,
                remember, csrf_hash, created_at, last_seen_at, expires_at
         FROM portal_sessions
         WHERE session_hash = ? AND expires_at > NOW(3)
         LIMIT 1`,
        [sessionHash]
    );
    const row = rows[0];
    if (!row) return null;
    if (config.clientAuth.mode === 'generated' && row.role === 'Cliente') return null;
    if (row.role === 'DevViewer' && !config.devViewer.enabled) return null;

    const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    if (Date.now() - lastSeen > 5 * 60 * 1000) {
        pool.query('UPDATE portal_sessions SET last_seen_at = NOW(3) WHERE session_hash = ?', [sessionHash])
            .catch(error => console.warn('[SESSION] Falha ao atualizar last_seen:', error.message));
    }

    return {
        hash: sessionHash,
        role: row.role,
        airtableId: row.airtable_client_id,
        documento: row.documento,
        email: row.email,
        nomeEmpresa: row.nome_empresa,
        remember: Boolean(row.remember),
        csrfHash: row.csrf_hash,
        expiresAt: row.expires_at
    };
}

async function destroySession(req, res) {
    const sessionHash = getSessionHash(req);
    if (sessionHash) await pool.query('DELETE FROM portal_sessions WHERE session_hash = ?', [sessionHash]);
    res.clearCookie(config.security.cookieName, { path: '/', sameSite: 'lax', secure: config.production || Boolean(req.secure), httpOnly: true });
}

async function rotateSession(req, res, session, nextRole, extra = {}) {
    const oldHash = session.hash;
    await pool.query('DELETE FROM portal_sessions WHERE session_hash = ?', [oldHash]);
    return createSession(req, res, {
        role: nextRole,
        airtableId: extra.airtableId ?? session.airtableId,
        documento: extra.documento ?? session.documento,
        email: extra.email ?? session.email,
        nomeEmpresa: extra.nomeEmpresa ?? session.nomeEmpresa
    }, { remember: extra.remember ?? session.remember });
}

async function issueFreshCsrf(session) {
    const raw = randomToken(24);
    await pool.query('UPDATE portal_sessions SET csrf_hash = ? WHERE session_hash = ?', [sha256(raw), session.hash]);
    session.csrfHash = sha256(raw);
    return raw;
}

function verifyCsrf(session, supplied) {
    if (!session || !supplied) return false;
    return safeEqualHex(session.csrfHash, sha256(String(supplied)));
}

async function cleanupSessions() {
    await pool.query('DELETE FROM portal_sessions WHERE expires_at <= NOW(3)');
}

module.exports = {
    createSession,
    loadSession,
    destroySession,
    rotateSession,
    issueFreshCsrf,
    verifyCsrf,
    cleanupSessions
};
