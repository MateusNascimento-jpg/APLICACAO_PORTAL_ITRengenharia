
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, '.itr-release.json');

function fail(message) {
  console.error(`[manifest] FALHA: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) fail('.itr-release.json não encontrado.');
let manifest;
try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
catch (_) { fail('manifesto JSON inválido.'); }

if (!Array.isArray(manifest.files) || manifest.hashAlgorithm !== 'SHA-256') {
  fail('formato de manifesto não reconhecido.');
}

for (const item of manifest.files) {
  if (!item || typeof item.path !== 'string' || !/^[a-f0-9]{64}$/i.test(String(item.sha256 || ''))) {
    fail('entrada inválida no manifesto.');
  }
  const normalized = path.normalize(item.path);
  const full = path.resolve(root, normalized);
  if (full !== root && !full.startsWith(root + path.sep)) fail(`caminho fora do release: ${item.path}`);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) fail(`arquivo ausente: ${item.path}`);
  const data = fs.readFileSync(full);
  if (data.length !== Number(item.size)) fail(`tamanho divergente: ${item.path}`);
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  if (hash !== item.sha256) fail(`SHA-256 divergente: ${item.path}`);
}

console.log(`[manifest] OK — ${manifest.files.length} arquivos íntegros (${manifest.release || 'release'}).`);
