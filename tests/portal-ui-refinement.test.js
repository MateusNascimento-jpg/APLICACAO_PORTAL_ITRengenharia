'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicRoot = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(publicRoot, 'portal.html'), 'utf8');
const js = fs.readFileSync(path.join(publicRoot, 'assets/js/portal.js'), 'utf8');
const css = fs.readFileSync(path.join(publicRoot, 'assets/css/original-portal.css'), 'utf8');

test('navegação começa com skeleton e sem exibir relatórios antes da autorização', () => {
  assert.match(html, /<body class="portal-carregando">/);
  assert.match(html, /id="portalSkeleton"[^>]*role="status"/);
  assert.match(html, /id="viewRelatorios" hidden/);
  assert.match(html, /id="navPropostas"[^>]*hidden/);
  assert.match(html, /id="navRelatorios" hidden/);
  assert.doesNotMatch(html, /Verificando funcionalidades disponíveis/);
});

test('falha de navegação mantém módulos indisponíveis e oferece retry', () => {
  assert.match(js, /NAVEGACAO_ATUAL = \{ propostas: false, relatorios: false \}/);
  assert.match(js, /document\.getElementById\('navPropostas'\)\.hidden = true/);
  assert.match(js, /document\.getElementById\('navRelatorios'\)\.hidden = true/);
  assert.match(js, /tentar\.hidden = false/);
  assert.match(js, /concluirCarregamentoNavegacao\(\)/);
});

test('propostas mostram skeleton real e o card expandido ganha destaque azul', () => {
  assert.match(js, /class="propostas-skeleton"/);
  assert.match(css, /\.proposta-card\.aberta\s*\{/);
  assert.match(css, /\.proposta-card\.aberta:hover\s*\{/);
  assert.match(css, /\.propostas-skeleton\s*\{/);
});

test('carregamento e animações respeitam preferências e estados ocultos', () => {
  assert.match(css, /body\.portal-carregando \.rodape-instit/);
  assert.match(css, /\.portal-skeleton\[hidden\]/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.portal-skeleton-linha\s*\{ animation: none; \}/);
});
