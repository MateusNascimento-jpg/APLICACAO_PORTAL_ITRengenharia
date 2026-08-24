const crypto = require('crypto');
const config = require('../config');

const pepper = Buffer.from(config.security.pepper, 'base64');

function hmac(value) { return crypto.createHmac('sha256', pepper).update(String(value ?? '')).digest('hex'); }
function sha256(value) { return crypto.createHash('sha256').update(String(value ?? '')).digest('hex'); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function randomPassword(length = 28) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_';
  let out = '';
  while (out.length < length) {
    const b = crypto.randomBytes(1)[0];
    if (b < 256 - (256 % alphabet.length)) out += alphabet[b % alphabet.length];
  }
  return out;
}
function scryptHash(password, saltHex = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) return reject(err);
      resolve({ salt: saltHex, hash: key.toString('hex') });
    });
  });
}
function scryptVerify(password, saltHex, expectedHex) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 }, (err, key) => {
      if (err) return reject(err);
      const expected = Buffer.from(String(expectedHex || ''), 'hex');
      resolve(expected.length === key.length && crypto.timingSafeEqual(expected, key));
    });
  });
}
function safeEqualHex(aHex, bHex) {
  try {
    const a = Buffer.from(String(aHex || ''), 'hex');
    const b = Buffer.from(String(bHex || ''), 'hex');
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) { return false; }
}
module.exports = { hmac, sha256, randomToken, randomPassword, scryptHash, scryptVerify, safeEqualHex };
