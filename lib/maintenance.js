const pool = require('../db');
const config = require('../config');

async function cleanupSecurityState() {
    await Promise.all([
        pool.query('DELETE FROM portal_sessions WHERE expires_at <= NOW(3)'),
        pool.query(`DELETE FROM portal_rate_limits
                    WHERE updated_at < DATE_SUB(NOW(3), INTERVAL 2 DAY)
                      AND (blocked_until IS NULL OR blocked_until < NOW(3))`),
        pool.query(`DELETE FROM portal_audit_events\n                    WHERE created_at < DATE_SUB(NOW(3), INTERVAL ${config.security.auditRetentionDays} DAY)`)
    ]);
}

function scheduleMaintenance() {
    const timer = setInterval(() => {
        cleanupSecurityState().catch(error => {
            console.warn('[MAINTENANCE] Limpeza periódica falhou:', error.message);
        });
    }, 60 * 60 * 1000);
    timer.unref();
    return timer;
}

module.exports = { cleanupSecurityState, scheduleMaintenance };
