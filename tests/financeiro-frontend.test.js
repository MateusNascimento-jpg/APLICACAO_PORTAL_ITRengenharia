'use strict';

// Contratos estáticos do frontend do Financeiro: integração mínima ao portal,
// acessibilidade das abas, ausência de innerHTML/armazenamento/polling e
// textos aprovados no handoff.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
// CRLF → LF: o clone no Windows (core.autocrlf) não pode mudar o resultado dos testes.
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
// Comentários explicativos podem citar o que é proibido; os testes olham só o código.
const semComentarios = codigo => codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const html = read('public/portal.html');
const js = read('public/assets/js/financeiro.js');
const portal = read('public/assets/js/portal.js');
const css = read('public/assets/css/financeiro.css');

test('portal.html: menu e painel ocultos por padrão, abas acessíveis e scripts na ordem correta', () => {
    assert.match(html, /id="navFinanceiro"[^>]*hidden/);
    assert.match(html, /id="painelFinanceiro" hidden/);
    assert.match(html, /role="tablist"[^>]*aria-label="Situação das faturas"/);
    for (const [id, aba, selecionada] of [
        ['finAbaProximas', 'proximas', 'true'],
        ['finAbaAPagar', 'a-pagar', 'false'],
        ['finAbaPagas', 'pagas', 'false'],
        ['finAbaCanceladas', 'canceladas', 'false'],
    ]) {
        const botao = new RegExp(`id="${id}"[^>]*role="tab"[^>]*data-aba="${aba}"[^>]*aria-selected="${selecionada}"[^>]*aria-controls="financeiroTabela"`);
        assert.match(html, botao, id);
    }
    assert.match(html, /id="financeiroTabela" role="tabpanel"/);
    assert.match(html, /Contratos, parcelas e documentos financeiros da sua empresa\./);
    const ordem = ['common.js', 'proposal-actions.js', 'portal.js', 'financeiro.js', 'account-security.js'].map(nome => html.indexOf(`assets/js/${nome}" defer`));
    assert.ok(ordem.every(i => i > 0), 'scripts com defer');
    assert.deepEqual([...ordem].sort((a, b) => a - b), ordem, 'financeiro.js carrega depois de portal.js');
    assert.match(html, /assets\/css\/financeiro\.css/);
    assert.match(html, /assets\/css\/original-portal\.css/);
});

test('financeiro.js só usa IDs existentes no portal.html', () => {
    const ids = new Set([...html.matchAll(/\bid=["']([^"']+)/g)].map(m => m[1]));
    const refs = new Set([...js.matchAll(/\$\(['"]([^'"]+)['"]\)|getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1] || m[2]));
    const botoes = [...js.matchAll(/botao: '([^']+)', total: '([^']+)'/g)].flatMap(m => [m[1], m[2]]);
    for (const id of [...refs, ...botoes]) assert.ok(ids.has(id), `#${id} ausente`);
});

test('financeiro.js: sem innerHTML, eval, Web Storage, polling ou URLs externas', () => {
    const codigo = semComentarios(js);
    assert.doesNotMatch(codigo, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    assert.doesNotMatch(codigo, /\beval\s*\(|new Function/);
    assert.doesNotMatch(codigo, /localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(codigo, /setInterval/);
    assert.doesNotMatch(codigo, /airtable/i);
    const chamadas = [...js.matchAll(/fetch\(([^,]+),/g)].map(m => m[1].trim());
    assert.deepEqual(chamadas, ["'/api/financeiro'", "'/api/navegacao'"], 'somente o painel e a revalidação da navegação');
    // Achado 1: nenhum reaproveitamento de dados financeiros no navegador.
    assert.doesNotMatch(codigo, /CACHE_MS|carregadoEm|atualizar=1/);
    assert.match(js, /function carregar\(\) \{\s*if \(estado\.emVoo\) return estado\.emVoo;\s*\/\/[^\n]*\n\s*estado\.dados = null;/);
    assert.match(js, /'\/api\/financeiro\/documentos\/' \+ encodeURIComponent\(doc\.tipo\)/);
    assert.match(js, /if \(resp\.status === 401\)[\s\S]{0,80}window\.location\.replace\('\/login\.html'\)/);
});

test('textos aprovados e estados obrigatórios estão presentes', () => {
    for (const texto of [
        'Preparando informações financeiras',
        'Informações em conferência',
        'Algumas informações financeiras estão em conferência pela ITR e aparecerão nesta área assim que forem confirmadas.',
        'Nenhuma fatura disponível no momento.',
        'Sua proposta foi aceita. As informações do contrato e das respectivas faturas estarão disponíveis nesta área após o processamento comercial.',
        'Não foi possível carregar suas informações financeiras. Tente novamente em instantes.',
        'Nenhuma fatura nesta categoria.',
        'Tentar novamente',
        'Vencimento não informado',
        'Ainda não há documentos anexados.',
    ]) {
        assert.ok(js.includes(texto), texto);
    }
    assert.doesNotMatch(js, /Contrato formal|Anexo Contrato/, 'proposta não é rotulada como contrato formal');
    assert.match(js, /aria-expanded/);
    assert.match(js, /aria-controls/);
    assert.match(js, /ArrowRight[\s\S]*ArrowLeft[\s\S]*Home[\s\S]*End/);
    assert.match(js, /estado\.dados = null;\s*mostrarErro\(\)/, 'erro descarta dados anteriores');
    assert.match(js, /Date\.now\(\) - ultimaRevisaoNavegacao < 30000/, 'revalidação da navegação é limitada (sem polling)');
    // Achado 3: cada estado do servidor tem tela própria; estado desconhecido vira erro.
    assert.match(js, /dados\.estado === 'processamento'\) \{ mostrarProcessamento\(\)/);
    assert.match(js, /dados\.estado === 'conferencia'\) \{ mostrarConferencia\(\)/);
    assert.match(js, /dados\.estado === 'vazio'\) \{ mostrarSemFaturas\(\)/);
    assert.match(js, /ESTADOS\.indexOf\(dados\.estado\) >= 0/);
});

test('portal.js: integração mínima e falha fechada da navegação', () => {
    assert.match(portal, /\['navRelatorios','navConta','navPropostas','navFinanceiro'\]/);
    assert.match(portal, /if\(painelFinanceiro\) painelFinanceiro\.hidden = true;/);
    assert.match(portal, /financeiro: data\.financeiro === true/);
    assert.match(portal, /document\.getElementById\('navFinanceiro'\)\.hidden = !NAVEGACAO_ATUAL\.financeiro;/);
    assert.match(portal, /document\.getElementById\('navFinanceiro'\)\.hidden = true;/);
    assert.match(portal, /NAVEGACAO_ATUAL = \{ propostas: false, relatorios: false \}/);
    for (const icone of ['file-invoice', 'barcode', 'download']) assert.ok(portal.includes(`'${icone}':'`), icone);
});

test('CSS do Financeiro: isolado, oculta [hidden], respeita movimento reduzido e usa tokens do tema', () => {
    assert.match(css, /#painelFinanceiro\[hidden\],\s*\.financeiro-painel \[hidden\] \{ display: none !important; \}/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /container: financeiro \/ inline-size/);
    assert.match(css, /font-variant-numeric: tabular-nums/);
    assert.doesNotMatch(css, /linear-gradient|radial-gradient/, 'sem gradientes decorativos');
    assert.doesNotMatch(css, /@import|url\(/, 'sem recursos externos');
    const seletores = [...css.matchAll(/^([^@{}\n][^{}]*)\{/gm)].map(m => m[1]);
    for (const seletor of seletores) {
        assert.match(seletor, /financeiro|fin-c-|#painelFinanceiro/, `seletor fora do escopo: ${seletor.trim()}`);
    }
});

test('módulo Financeiro não registra rotas de escrita nem envio de notificações', () => {
    const arquivos = fs.readdirSync(path.join(root, 'lib/financeiro')).map(nome => semComentarios(read(`lib/financeiro/${nome}`))).join('\n');
    assert.doesNotMatch(arquivos, /app\.(post|put|patch|delete)\(/);
    assert.doesNotMatch(arquivos, /method:\s*['"](POST|PATCH|PUT|DELETE)/i);
    assert.doesNotMatch(arquivos, /nodemailer|smtp|whatsapp|sendSecurityNotification|notifications/i);
    assert.doesNotMatch(arquivos, /fldVBdNqUGKx8S8Rb/, 'Anexo Contrato não é usado como documento');
    const servidor = read('server.js');
    assert.match(servidor, /require\('\.\/lib\/financeiro'\)\.install\(app, \{[\s\S]*auth: autenticado,[\s\S]*client: somenteClientePortal,/);
});
