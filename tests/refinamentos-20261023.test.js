'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {generate}=require('../lib/proposals/comprovante');
const src=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('o aceite confirmado atualiza as propostas do servidor sem recarregar o navegador',()=>{
    const actions=src('public/assets/js/proposal-actions.js');
    const portal=src('public/assets/js/portal.js');
    assert.match(portal,/ITRProposals\.accept\(proposta, botao, function \(\) \{ return carregarPropostas\(true\); \}\)/);
    assert.match(actions,/if \(typeof refresh === 'function'\) \{\s*await refresh\(\)/);
    assert.doesNotMatch(actions,/location\.reload\(/);
});

// Substitui a regra de 23/10 ("coluna de datas por parcela"): a decisão final
// é uma linha por contrato, com prazo contratual e sem datas de parcela.
test('Financeiro usa colunas de contrato: condição, valor total, prazo e situação consolidada',()=>{
    const financeiro=src('public/assets/js/financeiro.js');
    for (const rotulo of ['Contrato','Condição de pagamento','Valor total','Prazo para pagamento','Situação'])
        assert.match(financeiro,new RegExp(`rotulo: '${rotulo}'`));
    assert.doesNotMatch(financeiro,/Vencimento \/ prazo|Valor da parcela|rotulo: 'Parcela'/);
    assert.match(financeiro,/function textoPrazo\(dias, curto\)/);
    assert.match(financeiro,/estado\.abertas = new Set\(\)/);
});

test('página antiga preserva links já emitidos, mas orienta novos aceites para o Portal',()=>{
    const html=src('public/confirmar-proposta.html');
    const javascript=src('public/assets/js/proposal-confirm.js');
    assert.doesNotMatch(html,/Código exibido no Portal/);
    assert.match(html,/aba Propostas/);
    assert.match(javascript,/if \(!token\) \{/);
    assert.match(javascript,/call\('abrir', \{ token: token \}\)/); // compatibilidade do link antigo
});

test('dados institucionais do comprovante permanecem na mesma página',()=>{
    const pdf=generate({proposal:{id:'recAAAAAAAAAAAAAA',cnpj:'12345678000199',numero:'03',nomeCliente:'Exemplo',valor:2500,
        formaPagamento:'Entrada + parcela final',prazoPagamentoDias:10,descricao:'Ensaio geotécnico'},
        attachmentId:'attEEEEEEEEEEEEEE',pdfHash:'f'.repeat(64),version:'e'.repeat(64),
        acceptedAt:Date.parse('2026-10-23T11:00:00Z'),origin:'https://portal.example.test/'}).bytes.toString('latin1');
    const streams=[...pdf.matchAll(/\nstream\n([\s\S]*?)endstream/g)].map(m=>m[1]);
    const institutional=streams.filter(s=>s.includes('Dados institucionais da ITR Engenharia'));
    assert.equal(institutional.length,1);
    for(const text of ['Razão Social','CNPJ','Inscrição Estadual','Responsável comercial'])
        assert.ok(institutional[0].includes(text), text+' deve constar na mesma página');
    assert.match(pdf,/Integridade do aceite/);
});
