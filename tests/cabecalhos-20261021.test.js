'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../public/portal.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/assets/css/itr-ux-composicao.css'), 'utf8');

test('quatro cabeçalhos enriquecidos, sem alterar nomes ou IDs dos módulos', () => {
  for (const id of ['viewRelatorios', 'painelConta', 'painelPropostas', 'painelFinanceiro']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
  }
  for (const nome of ['relatorios', 'conta', 'propostas', 'financeiro']) {
    assert.match(html, new RegExp(`itr-header--${nome}`));
  }
  for (const id of ['saudacao', 'nomeCliente', 'nomeTexto', 'freshness', 'freshnessTxt',
    'contaEmpresa', 'contaCnpj', 'contaEmail', 'contaWhatsapp', 'propostasContagem',
    'financeiroTitulo', 'financeiroAtualizado']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
  }
  assert.match(html, /<h2 class="conta-titulo">Minha conta<\/h2>/);
  assert.match(html, /data-kpi="todos"/);
  // Abas do Financeiro removidas por decisão final (24/10): uma linha por contrato.
  assert.doesNotMatch(html, /data-aba="proximas"/);
});

test('CSS usa cabeçalho compacto, responsivo e tema escuro aprofundado', () => {
  assert.match(css, /--bg:\s*#0b1017;/);
  assert.match(css, /--bg-deep:\s*#080d13;/);
  assert.match(css, /--itr-header-bg:\s*#101722;/);
  assert.match(css, /:root\[data-tema="claro"\]\s*\{[\s\S]*?--itr-header-bg:\s*#171e2a;/);
  assert.match(css, /@media \(max-width: 920px\)/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /\.tl \.et\.atual:last-child \.bolha\s*\{\s*animation:\s*pulsar/);
});
