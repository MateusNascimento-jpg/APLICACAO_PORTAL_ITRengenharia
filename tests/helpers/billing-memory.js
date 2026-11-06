'use strict';
const { createCipher } = require('../../lib/billing/crypto');
const { canonical } = require('../../lib/billing/protocol');
function memoryStore() {
    let data = { meta: null, general: null, states: new Map(), events: new Map(), versions: new Map(), audit: [], nonces: new Set() };
    const locks = new Set();
    let failCommit = false;
    const copy = structuredClone;
    const repo = {
        meta: async () => copy(data.meta), saveMeta: async d => { data.meta = copy(d); },
        generalMode: async () => copy(data.general), saveGeneralMode: async d => { data.general = copy(d); },
        state: async id => copy(data.states.get(id)), saveState: async (id, d) => { data.states.set(id, copy(d)); },
        event: async id => copy(data.events.get(id)),
        events: async id => copy([...data.events.values()].filter(e => e.payload.invoiceId === id)),
        async saveEvent(e) {
            const old = data.events.get(e.payload.eventId);
            if (old && canonical(old.payload) !== canonical(e.payload)) throw new Error('EVENT_CONFLICT');
            data.events.set(e.payload.eventId, copy(e));
        },
        version: async s => { data.versions.set(s.stateVersion, copy(s)); },
        audit: async (subject, code, now) => { data.audit.push({ subject, code, now }); },
        async auditOnce(subject, code, now) {
            if (!data.audit.some(a => a.subject === subject && a.code === code && a.now > now - 86400000)) await this.audit(subject, code, now);
        },
        async transaction(work) {
            const previous = copy(data);
            try { const value = await work(); if (failCommit) throw new Error('MYSQL_UNAVAILABLE'); return value; }
            catch (e) { data = previous; throw e; }
        }
    };
    return {
        repo, cipher: createCipher(Buffer.alloc(32, 8).toString('base64')),
        get data() { return data; }, failCommit: value => { failCommit = value; },
        async locked(scope, work) {
            if (locks.has(scope)) throw new Error('BUSY');
            locks.add(scope); try { return await work(repo); } finally { locks.delete(scope); }
        },
        async nonce(nonce) { if (data.nonces.has(nonce)) return false; data.nonces.add(nonce); return true; },
        async due(now) { return copy([...data.events.values()].filter(e => ['pending', 'retry', 'sending'].includes(e.status) && e.nextAt <= now)); }
    };
}
module.exports = { memoryStore };
