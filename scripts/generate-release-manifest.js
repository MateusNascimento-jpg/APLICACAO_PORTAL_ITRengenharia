
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.itr-release.json');
const excludedDirs = new Set(['.git', 'node_modules', '.vscode', 'coverage']);
const excludedFiles = new Set(['.env', '.itr-release.json']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (excludedDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (!excludedFiles.has(entry.name) && !entry.name.endsWith('.zip')) out.push(full);
  }
  return out;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const files = walk(root)
  .map(file => ({
    path: path.relative(root, file).split(path.sep).join('/'),
    size: fs.statSync(file).size,
    sha256: sha256(file)
  }))
  .sort((a, b) => a.path.localeCompare(b.path));

const manifest = {
  product: 'Portal ITR Engenharia',
  release: `v${pkg.version}`,
  createdAt: new Date().toISOString(),
  hashAlgorithm: 'SHA-256',
  fileCount: files.length,
  files
};

fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`[manifest] ${files.length} arquivos registrados em .itr-release.json`);
