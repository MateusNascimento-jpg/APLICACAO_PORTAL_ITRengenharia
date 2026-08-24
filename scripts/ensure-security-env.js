'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envPath = path.join(__dirname, '..', '.env');

function parseEnv(text) {
  const values = new Map();
  text.split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) values.set(match[1], match[2].trim());
  });
  return values;
}

function upsert(text, key, value) {
  const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, `${key}=${value}`);
  const separator = text.endsWith('\n') || text.length === 0 ? '' : '\n';
  return `${text}${separator}${key}=${value}\n`;
}

function base64(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64');
}

if (!fs.existsSync(envPath)) {
  console.error('[env] Arquivo .env não encontrado. O atualizador preserva o .env do projeto existente; confira o caminho antes de continuar.');
  process.exit(1);
}

let text = fs.readFileSync(envPath, 'utf8');
const env = parseEnv(text);
const generated = [];

for (const key of ['PORTAL_SECURITY_PEPPER']) {
  if (!env.get(key)) {
    text = upsert(text, key, base64(32));
    generated.push(key);
  }
}

if (generated.length) {
  if (!text.includes('# Chaves adicionadas automaticamente pelo Portal ITR v2.')) {
    text += '\n# Chaves adicionadas automaticamente pelo Portal ITR v2.\n';
  }
  fs.writeFileSync(envPath, text, { encoding: 'utf8', mode: 0o600 });
  console.log(`[env] ${generated.length} chave(s) de segurança criada(s): ${generated.join(', ')}.`);
} else {
  console.log('[env] Chaves de segurança já existentes e preenchidas; nenhum valor foi alterado.');
}
