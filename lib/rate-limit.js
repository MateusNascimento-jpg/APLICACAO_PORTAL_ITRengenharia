const pool = require('../db');
const { hmac } = require('./security-crypto');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function consume(scope, rawKey, { limit, windowMs, blockMs = windowMs }) {
    const keyHash = hmac(`${scope}:${rawKey}`);
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Garante a linha antes do SELECT FOR UPDATE. Isso evita corrida quando
        // duas tentativas chegam exatamente ao mesmo tempo para uma chave nova.
        await conn.query(
            `INSERT INTO portal_rate_limits (scope, key_hash, window_started_at, attempts)
             VALUES (?, ?, NOW(3), 0)
             ON DUPLICATE KEY UPDATE scope = VALUES(scope)`,
            [scope, keyHash]
        );

        const [rows] = await conn.query(
            `SELECT window_started_at, attempts, blocked_until
             FROM portal_rate_limits WHERE scope = ? AND key_hash = ? FOR UPDATE`,
            [scope, keyHash]
        );
        const row = rows[0];
        const now = Date.now();
        const blockedUntil = row.blocked_until ? new Date(row.blocked_until).getTime() : 0;

        if (blockedUntil > now) {
            await conn.commit();
            return { ok: false, retryAfterMs: blockedUntil - now };
        }

        const started = row.window_started_at ? new Date(row.window_started_at).getTime() : 0;
        const novaJanela = !Number.isFinite(started) || now - started >= windowMs;
        const attempts = novaJanela ? 1 : Number(row.attempts || 0) + 1;

        if (attempts > limit) {
            const blockedDate = new Date(now + blockMs);
            await conn.query(
                `UPDATE portal_rate_limits
                 SET attempts = ?, window_started_at = ${novaJanela ? 'NOW(3)' : 'window_started_at'}, blocked_until = ?
                 WHERE scope = ? AND key_hash = ?`,
                [attempts, blockedDate, scope, keyHash]
            );
            await conn.commit();
            return { ok: false, retryAfterMs: blockMs };
        }

        await conn.query(
            `UPDATE portal_rate_limits
             SET attempts = ?, window_started_at = ${novaJanela ? 'NOW(3)' : 'window_started_at'}, blocked_until = NULL
             WHERE scope = ? AND key_hash = ?`,
            [attempts, scope, keyHash]
        );
        await conn.commit();
        return { ok: true, remaining: Math.max(0, limit - attempts) };
    } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        throw error;
    } finally {
        conn.release();
    }
}

async function reset(scope, rawKey) {
    const keyHash = hmac(`${scope}:${rawKey}`);
    await pool.query('DELETE FROM portal_rate_limits WHERE scope = ? AND key_hash = ?', [scope, keyHash]);
}

async function defensiveDelay() {
    await sleep(180 + Math.floor(Math.random() * 220));
}

module.exports = { consume, reset, defensiveDelay };
