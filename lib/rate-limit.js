const pool = require('../db');
const { hmac } = require('./security-crypto');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Todas as datas gravadas aqui saem do relógio do Node (parâmetros Date), nunca
// de NOW(3): o mysql2 converte a gravação e a leitura com o MESMO fuso da
// conexão, então a janela não "anda" quando MySQL e aplicação usam fusos
// diferentes (antes, um servidor em UTC e um Node em -03 congelavam a janela
// por até 3 h). `untilWindowEnd` limita o bloqueio ao fim da janela corrente,
// sem acrescentar uma penalidade extra de windowMs.
async function consume(scope, rawKey, { limit, windowMs, blockMs = windowMs, untilWindowEnd = false }) {
    const keyHash = hmac(`${scope}:${rawKey}`);
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const now = Date.now();

        // Garante a linha antes do SELECT FOR UPDATE. Isso evita corrida quando
        // duas tentativas chegam exatamente ao mesmo tempo para uma chave nova.
        await conn.query(
            `INSERT INTO portal_rate_limits (scope, key_hash, window_started_at, attempts)
             VALUES (?, ?, ?, 0)
             ON DUPLICATE KEY UPDATE scope = VALUES(scope)`,
            [scope, keyHash, new Date(now)]
        );

        const [rows] = await conn.query(
            `SELECT window_started_at, attempts, blocked_until
             FROM portal_rate_limits WHERE scope = ? AND key_hash = ? FOR UPDATE`,
            [scope, keyHash]
        );
        const row = rows[0];
        const blockedUntil = row.blocked_until ? new Date(row.blocked_until).getTime() : 0;

        if (blockedUntil > now) {
            await conn.commit();
            return { ok: false, retryAfterMs: blockedUntil - now };
        }

        const started = row.window_started_at ? new Date(row.window_started_at).getTime() : 0;
        // Início no futuro só ocorre com relógio/fuso inconsistente: reinicia.
        const novaJanela = !Number.isFinite(started) || now - started >= windowMs || started > now;
        const inicio = novaJanela ? now : started;
        const attempts = novaJanela ? 1 : Number(row.attempts || 0) + 1;

        if (attempts > limit) {
            const espera = untilWindowEnd ? Math.max(1000, inicio + windowMs - now) : blockMs;
            await conn.query(
                `UPDATE portal_rate_limits
                 SET attempts = ?, window_started_at = ?, blocked_until = ?
                 WHERE scope = ? AND key_hash = ?`,
                [attempts, new Date(inicio), new Date(now + espera), scope, keyHash]
            );
            await conn.commit();
            return { ok: false, retryAfterMs: espera };
        }

        await conn.query(
            `UPDATE portal_rate_limits
             SET attempts = ?, window_started_at = ?, blocked_until = NULL
             WHERE scope = ? AND key_hash = ?`,
            [attempts, new Date(inicio), scope, keyHash]
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
