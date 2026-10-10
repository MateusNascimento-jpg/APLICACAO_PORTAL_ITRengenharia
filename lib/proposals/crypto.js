'use strict';

const crypto = require('node:crypto');

function createSecrets(pepper) {
    const root = Buffer.from(pepper, 'base64');
    if (root.length < 32) throw new Error('PROPOSALS_KEY_INVALID');
    const derive = (purpose) =>
        Buffer.from(
            crypto.hkdfSync('sha256', root, Buffer.alloc(0), `itr:proposals:v1:${purpose}`, 32),
        );
    const key = derive('encryption');
    const mac = (value) => crypto.createHmac('sha256', derive('code')).update(value).digest('hex');

    return {
        code: () => String(crypto.randomInt(0, 100000000)).padStart(8, '0'),
        token: () => crypto.randomBytes(32).toString('base64url'),
        hash: (value) => crypto.createHash('sha256').update(value).digest('hex'),
        codeHash: (id, code) => mac(`${id}:${code}`),
        equal(a, b) {
            if (typeof a !== 'string' || typeof b !== 'string') return false;
            const left = Buffer.from(a);
            const right = Buffer.from(b);
            return left.length === right.length && crypto.timingSafeEqual(left, right);
        },
        seal(value) {
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            const data = Buffer.concat([
                cipher.update(JSON.stringify(value), 'utf8'),
                cipher.final(),
            ]);
            return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
        },
        open(value) {
            const bytes = Buffer.from(value, 'base64');
            const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
            cipher.setAuthTag(bytes.subarray(12, 28));
            return JSON.parse(
                Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'),
            );
        },
    };
}

module.exports = { createSecrets };
