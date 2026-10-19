const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const marker = path.join(root, '.itr-preview-local.json');
function allowed(env = process.env, file = marker) {
  if (env.NODE_ENV !== 'development' || env.VERCEL || env.VERCEL_ENV || env.RENDER || env.RENDER_SERVICE_ID) return false;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value.root === root && value.isolatedPreview === true;
  } catch { return false; }
}
function assertAllowed() {
  if (!allowed()) throw new Error('Prévia recusada: exige autorização local e ambiente development fora de deployments.');
}
module.exports = { root, marker, allowed, assertAllowed };
