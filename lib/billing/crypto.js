'use strict';
const crypto = require('node:crypto');
function createCipher(secret) {
    const root = Buffer.from(secret, 'base64');
    if (root.length < 32) throw new Error('BILLING_KEY_INVALID');
    const derive = purpose => Buffer.from(crypto.hkdfSync('sha256', root, Buffer.alloc(0), 'itr:billing:v1:' + purpose, 32));
    const key = derive('storage');
    return {
        tag: value => crypto.createHmac('sha256', derive('identity')).update(value).digest('hex'),
        seal(value) {
            const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
            const bytes = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
            return Buffer.concat([iv, c.getAuthTag(), bytes]).toString('base64');
        },
        open(value) {
            const b = Buffer.from(value, 'base64'), c = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
            c.setAuthTag(b.subarray(12, 28));
            return JSON.parse(Buffer.concat([c.update(b.subarray(28)), c.final()]));
        }
    };
}
module.exports = { createCipher };
