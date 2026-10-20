'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.join(__dirname,'..','public');
const html = fs.readFileSync(path.join(base,'portal.html'),'utf8');
const js = fs.readFileSync(path.join(base,'assets/js/portal.js'),'utf8');
const css = fs.readFileSync(path.join(base,'assets/css/itr-ux-composicao.css'),'utf8');
function testarAbertura(propostas){
  const inicio = js.indexOf('var propostasAbertasIds = new Set();');
  const fim = js.indexOf('\nfunction moedaBR(',inicio);
  assert.ok(inicio >= 0 && fim > inicio);
  const contexto = vm.createContext({ Set, Date });
  vm.runInContext(js.slice(inicio,fim),contexto);
  contexto.inicializarAberturaPropostas(propostas);
  return contexto;
}
test('até três propostas iniciam expandidas e podem ser fechadas individualmente',()=>{
  const ctx = testarAbertura([{id:'a'},{id:'b'},{id:'c'}]);
  assert.deepEqual([...ctx.propostasAbertasIds],['a','b','c']);
  ctx.propostasAbertasIds.delete('b');
  ctx.inicializarAberturaPropostas([{id:'a'},{id:'b'},{id:'c'}]);
  assert.deepEqual([...ctx.propostasAbertasIds],['a','c']);
});
test('com quatro ou mais, inicia somente a proposta de data mais recente',()=>{
  const ctx = testarAbertura([
    {id:'velha',dataEnvio:'2026-01-10'},
    {id:'recente',dataEnvio:'2026-10-01'},
    {id:'outra',dataEnvio:'2026-06-01'},
    {id:'quarta',dataEnvio:'2026-09-01'}
  ]);
  assert.deepEqual([...ctx.propostasAbertasIds],['recente']);
});
test('novo layout mantém os contratos de frontend e módulos',()=>{
  assert.match(html,/id="painelPropostas"/);
  assert.match(html,/id="viewRelatorios"/);
  assert.match(html,/id="financeiroTabela"/);
  assert.match(html,/id="nomeTexto"/);
  assert.match(html,/id="propostasContagem"/);
  assert.match(html,/itr-ux-composicao\.css/);
  assert.match(html,/privacidade\.html/);
  assert.doesNotMatch(html,/class="rodape-instit"/);
  assert.match(css,/#campo, #vinheta\s*\{ display: none !important/);
});

test('Minha conta utiliza título de mesma hierarquia visual que os outros módulos',()=>{
  assert.match(html, /<h2 class="conta-titulo">Minha conta<\/h2>/);
  assert.match(css, /\.conta-titulo\s*\{[^}]*font-size:\s*clamp\(27px,\s*2\.2vw,\s*36px\);[^}]*font-weight:\s*700;/s);
});
test('etapa final dos relatórios pulsa e respeita preferência de movimento reduzido',()=>{
  assert.match(css, /\.tl \.et\.atual:last-child \.bolha\s*\{\s*animation:\s*pulsar 1\.8s ease-in-out infinite;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.tl \.et\.atual:last-child \.bolha\s*\{\s*animation:\s*none;/);
});
