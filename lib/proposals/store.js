'use strict';

const crypto = require('node:crypto');

const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

function createStore(pool) {
    function repository(connection) {
        const query = (sql, values = []) => connection.query(sql, values);
        return {
            async state(id) {
                const [rows] = await query('SELECT data FROM portal_proposal_state WHERE id = ?', [
                    id,
                ]);
                return rows.length ? parse(rows[0].data) : {};
            },
            async saveState(id, data) {
                await query(
                    'INSERT INTO portal_proposal_state (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
                    [id, JSON.stringify(data)],
                );
            },
            async challenge(id) {
                const [rows] = await query(
                    'SELECT data FROM portal_proposal_challenges WHERE id = ?',
                    [id],
                );
                return rows.length ? parse(rows[0].data) : null;
            },
            async token(hash) {
                const [rows] = await query(
                    'SELECT data FROM portal_proposal_challenges WHERE token_hash = ?',
                    [hash],
                );
                return rows.length ? parse(rows[0].data) : null;
            },
            async saveChallenge(data) {
                await query(
                    `INSERT INTO portal_proposal_challenges (id, token_hash, proposal_id, expires_at, data)
                    VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)`,
                    [
                        data.id,
                        data.tokenHash,
                        data.proposalId,
                        data.expiresAt,
                        JSON.stringify(data),
                    ],
                );
            },
            async invoiceState(id) {
                const [rows] = await query('SELECT data FROM portal_nf_notification_state WHERE nf_id = ?', [id]);
                return rows.length ? parse(rows[0].data) : null;
            },
            async saveInvoiceState(id, data) {
                await query(`INSERT INTO portal_nf_notification_state (nf_id, data) VALUES (?, ?)
                    ON DUPLICATE KEY UPDATE data=VALUES(data)`, [id, JSON.stringify(data)]);
            },
            async artifact(id) {
                const [rows] = await query('SELECT * FROM portal_proposal_artifacts WHERE proposal_id = ?', [id]);
                return rows[0] || null;
            },
            async saveArtifact(data) {
                await query(
                    `INSERT IGNORE INTO portal_proposal_artifacts
                    (proposal_id, cnpj, version, original_sha256, comprovante_sha256,
                     original_name, original_pdf, comprovante_pdf, accepted_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [data.proposalId, data.cnpj, data.version, data.originalHash, data.proofHash,
                        data.filename, data.original, data.proof, data.acceptedAt],
                );
                const existing = await this.artifact(data.proposalId);
                if (!existing || existing.version !== data.version ||
                    existing.original_sha256 !== data.originalHash ||
                    existing.comprovante_sha256 !== data.proofHash) {
                    throw new Error('ARTIFACT_VERSION_CONFLICT');
                }
            },
            async enqueue(event) {
                await query(
                    `INSERT IGNORE INTO portal_proposal_outbox (id, proposal_id, priority, payload)
                    VALUES (?, ?, ?, ?)`,
                    [event.id, event.proposalId, event.priority, event.payload],
                );
            },
            async event(id) {
                const [rows] = await query('SELECT * FROM portal_proposal_outbox WHERE id = ?', [
                    id,
                ]);
                return rows[0] || null;
            },
            async eventState(id, status, nextAt = 0) {
                await query(
                    `UPDATE portal_proposal_outbox SET status = ?, next_at = ?, attempts = attempts + 1 WHERE id = ?`,
                    [status, nextAt, id],
                );
            },
            async transaction(work) {
                await connection.beginTransaction();
                try {
                    const result = await work();
                    await connection.commit();
                    return result;
                } catch (error) {
                    await connection.rollback();
                    throw error;
                }
            },
        };
    }

    return {
        ...repository(pool),
        async settings() {
            const [rows] = await pool.query(
                'SELECT data FROM portal_proposal_settings WHERE id = 1',
            );
            return rows.length ? parse(rows[0].data) : { enabled: false };
        },
        async withLock(id, work) {
            const connection = await pool.getConnection();
            const name =
                'itr-prop-' + crypto.createHash('sha256').update(id).digest('hex').slice(0, 48);
            let acquired = false;
            try {
                const [rows] = await connection.query('SELECT GET_LOCK(?, 2) AS acquired', [name]);
                acquired = Number(rows[0].acquired) === 1;
                if (!acquired) throw new Error('PROPOSAL_BUSY');
                return await work(repository(connection));
            } finally {
                if (acquired)
                    await connection.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => {});
                connection.release();
            }
        },
        async due() {
            const [rows] = await pool.query(
                `SELECT id, proposal_id FROM portal_proposal_outbox
                WHERE status = 'pending' AND next_at <= ? ORDER BY priority ASC, next_at ASC LIMIT 20`,
                [Date.now()],
            );
            return rows;
        },
        async applying() {
            const [rows] = await pool.query(`SELECT id FROM portal_proposal_state
                WHERE JSON_UNQUOTE(JSON_EXTRACT(data, '$.decision.state')) = 'applying' LIMIT 50`);
            return rows.map((row) => row.id);
        },
        async nonce(id) {
            await pool.query('DELETE FROM portal_proposal_nonces WHERE expires_at < ?', [
                Date.now(),
            ]);
            try {
                await pool.query(
                    'INSERT INTO portal_proposal_nonces (id, expires_at) VALUES (?, ?)',
                    [id, Date.now() + 610000],
                );
                return true;
            } catch (error) {
                if (error.code === 'ER_DUP_ENTRY') return false;
                throw error;
            }
        },
        async cleanup() {
            await pool.query('DELETE FROM portal_proposal_challenges WHERE expires_at < ?', [
                Date.now() - 7 * 86400000,
            ]);
            // Preserve IDs/status indefinitely for idempotency; purge bearer tokens and personal payloads.
            await pool.query(`UPDATE portal_proposal_outbox SET payload = '' WHERE status IN ('sent', 'cancelled')
                AND payload <> '' AND updated_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`);
        },
    };
}

module.exports = { createStore };
