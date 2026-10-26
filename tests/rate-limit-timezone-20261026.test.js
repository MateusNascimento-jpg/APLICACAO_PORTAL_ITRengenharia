'use strict';

// Rate limit persistente com MySQL e Node em fusos diferentes. O pool falso
// emula o mysql2: parâmetros Date viram texto no fuso da CONEXÃO e DATETIME
// volta a Date no mesmo fuso; NOW(3) usaria o fuso do SERVIDOR MySQL.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const CLIENT_OFFSET = -180; // Node/conexão em America/Sao_Paulo
const SERVER_OFFSET = 0; // MySQL em UTC

function format(ms, offsetMin) {
    return new Date(ms + offsetMin * 60000).toISOString().replace('T', ' ').replace('Z', '');
}
function parse(text, offsetMin) {
    return new Date(Date.parse(text.replace(' ', 'T') + 'Z') - offsetMin * 60000);
}

function fakePool() {
    const rows = new Map();
    const sql = [];
    const value = (v) => (v instanceof Date ? format(v.getTime(), CLIENT_OFFSET) : v);
    const conn = {
        async query(text, params = []) {
            sql.push(text);
            if (/NOW\(/.test(text)) {
                // Comportamento antigo: hora do servidor MySQL, em outro fuso.
                text = text.replace(/NOW\(3\)/g, `'${format(Date.now(), SERVER_OFFSET)}'`);
            }
            if (/^\s*INSERT INTO portal_rate_limits/.test(text)) {
                const [scope, key, started] = params;
                const id = scope + key;
                const startedText = started === undefined ? /'([^']+)'/.exec(text)[1] : value(started);
                if (!rows.has(id)) rows.set(id, { window_started_at: startedText, attempts: 0, blocked_until: null });
                return [{}];
            }
            if (/^\s*SELECT window_started_at/.test(text)) {
                const row = rows.get(params[0] + params[1]);
                return [[{ attempts: row.attempts,
                    window_started_at: row.window_started_at && parse(row.window_started_at, CLIENT_OFFSET),
                    blocked_until: row.blocked_until && parse(row.blocked_until, CLIENT_OFFSET) }]];
            }
            if (/^\s*UPDATE portal_rate_limits/.test(text)) {
                // Lê o SET na ordem: aceita parâmetro, literal ou a própria coluna.
                const queue = [...params];
                const take = (expr, current) => (expr === '?' ? value(queue.shift())
                    : expr === 'NULL' ? null : expr.startsWith("'") ? expr.slice(1, -1) : current);
                const set = /SET (.*?)\s+WHERE/s.exec(text)[1].split(',').map((part) => part.trim().split(/\s*=\s*/));
                const pending = set.map(([column, expr]) => [column, expr]);
                const attempts = take(pending[0][1]);
                const [scope, key] = queue.slice(-2);
                const row = rows.get(scope + key);
                row.attempts = attempts;
                row.window_started_at = take(pending[1][1], row.window_started_at);
                row.blocked_until = take(pending[2][1], row.blocked_until);
                return [{}];
            }
            return [{}];
        },
        beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
    };
    return { sql, pool: { getConnection: async () => conn, query: conn.query } };
}

function load(pool) {
    const root = path.join(__dirname, '..');
    require.cache[require.resolve(path.join(root, 'db'))] = { exports: pool };
    require.cache[require.resolve(path.join(root, 'lib/security-crypto'))] = {
        exports: { hmac: (v) => 'h:' + v },
    };
    delete require.cache[require.resolve(path.join(root, 'lib/rate-limit'))];
    return require('../lib/rate-limit');
}

test('janela usa o relógio da aplicação: reinicia no prazo mesmo com MySQL em outro fuso', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-26T15:00:00Z') });
    const fake = fakePool();
    const { consume } = load(fake.pool);
    const opts = { limit: 3, windowMs: 30 * 60000, untilWindowEnd: true };
    for (let i = 0; i < 3; i++) assert.equal((await consume('s', 'k', opts)).ok, true);
    t.mock.timers.tick(10 * 60000);
    const blocked = await consume('s', 'k', opts);
    // Bloqueio só até o fim da janela corrente (20 min), não +30 min.
    assert.deepEqual(blocked, { ok: false, retryAfterMs: 20 * 60000 });
    t.mock.timers.tick(5 * 60000);
    assert.deepEqual(await consume('s', 'k', opts), { ok: false, retryAfterMs: 15 * 60000 });
    t.mock.timers.tick(15 * 60000);
    assert.equal((await consume('s', 'k', opts)).ok, true);
    assert.ok(fake.sql.every((q) => !/NOW\(/.test(q)), 'nenhuma data do servidor MySQL');
});

test('chamadores existentes mantêm a penalidade padrão (blockMs = windowMs)', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-26T15:00:00Z') });
    const { consume } = load(fakePool().pool);
    const opts = { limit: 1, windowMs: 60000 };
    assert.equal((await consume('login', 'x', opts)).ok, true);
    assert.deepEqual(await consume('login', 'x', opts), { ok: false, retryAfterMs: 60000 });
});

test('início de janela no futuro (relógio inconsistente) não congela o contador', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-26T15:00:00Z') });
    const fake = fakePool();
    const { consume } = load(fake.pool);
    const opts = { limit: 1, windowMs: 60000, untilWindowEnd: true };
    assert.equal((await consume('s', 'f', opts)).ok, true);
    t.mock.timers.setTime(Date.parse('2026-10-26T12:00:00Z')); // relógio volta 3 h
    assert.equal((await consume('s', 'f', opts)).ok, true);
});
