'use strict';
const { hash, canonical } = require('./protocol');
const { createCipher } = require('./crypto');
// No database connection is opened on import. All writes are confined to billing tables.
function createStore(pool, storageKey) {
    const cipher = createCipher(storageKey);
    function repository(conn) {
        async function get(table, id) {
            const [rows] = await conn.query(`SELECT data FROM portal_billing_${table} WHERE id = ?`, [id]);
            return rows.length ? cipher.open(rows[0].data) : null;
        }
        async function put(table, id, data) {
            await conn.query(`INSERT INTO portal_billing_${table} (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data=VALUES(data)`, [id, cipher.seal(data)]);
        }
        return {
            meta: () => get('meta', 'baseline'), saveMeta: data => put('meta', 'baseline', data),
            state: id => get('states', id), saveState: (id, data) => put('states', id, data),
            event: id => get('outbox', id),
            document: id => get('documents', id),
            async events(invoiceId) {
                const [rows] = await conn.query('SELECT data FROM portal_billing_outbox WHERE invoice_id = ?', [invoiceId]);
                return rows.map(r => cipher.open(r.data));
            },
            async saveEvent(e) {
                const old = await this.event(e.payload.eventId);
                if (old && canonical(old.payload) !== canonical(e.payload)) throw new Error('EVENT_CONFLICT');
                await conn.query(`INSERT INTO portal_billing_outbox (id, invoice_id, status, next_at, data) VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE status=VALUES(status), next_at=VALUES(next_at), data=VALUES(data)`,
                [e.payload.eventId, e.payload.invoiceId, e.status, e.nextAt || 0, cipher.seal(e)]);
            },
            async version(s) {
                await conn.query('INSERT IGNORE INTO portal_billing_versions (id, invoice_id, data) VALUES (?, ?, ?)',
                    [s.stateVersion, s.invoiceId, cipher.seal(s)]);
            },
            async audit(subject, code, now) {
                if (!/^[A-Z0-9_]{1,64}$/.test(code)) code = 'INTERNAL_FAILURE';
                await conn.query('INSERT INTO portal_billing_audit (at_ms, subject, code) VALUES (?, ?, ?)', [now, subject, code]);
            },
            // For conditions observed on every scan: one row per subject and code each day.
            async auditOnce(subject, code, now) {
                if (!/^[A-Z0-9_]{1,64}$/.test(code)) code = 'INTERNAL_FAILURE';
                const [rows] = await conn.query('SELECT 1 FROM portal_billing_audit WHERE subject = ? AND code = ? AND at_ms > ? LIMIT 1', [subject, code, now - 86400000]);
                if (!rows.length) await this.audit(subject, code, now);
            },
            async transaction(work) {
                await conn.beginTransaction();
                try { const result = await work(); await conn.commit(); return result; }
                catch (error) { await conn.rollback(); throw error; }
            }
        };
    }
    async function locked(scope, work) {
        const conn = await pool.getConnection();
        const name = 'billing:' + hash(scope).slice(0, 56);
        let acquired = false;
        try {
            const [rows] = await conn.query('SELECT GET_LOCK(?, 0) AS acquired', [name]);
            acquired = Number(rows[0]?.acquired) === 1;
            if (!acquired) throw new Error('BUSY');
            return await work(repository(conn));
        } finally {
            try { if (acquired) await conn.query('SELECT RELEASE_LOCK(?)', [name]); }
            finally { conn.release(); }
        }
    }
    return {
        cipher, locked, repo: repository(pool),
        async nonce(nonce, now) {
            try { await pool.query('INSERT INTO portal_billing_nonces (id, seen_at) VALUES (?, ?)', [hash(nonce), now]); return true; }
            catch (e) { if (e.code === 'ER_DUP_ENTRY') return false; throw e; }
        },
        async due(now) {
            const [rows] = await pool.query("SELECT data FROM portal_billing_outbox WHERE status IN ('pending','retry','sending') AND next_at <= ? ORDER BY next_at, id LIMIT 50", [now]);
            return rows.map(r => cipher.open(r.data));
        }
    };
}
module.exports = { createStore };
