'use strict';

// Comprovante de Contrato (P1, handoff 24/10): selo "Condições comerciais" à
// direita do título, CNPJ formatado, valor nunca "R$ 0,00" por ausência e
// seções curtas (título + texto) sem quebra entre páginas.

const test = require('node:test');
const assert = require('node:assert/strict');
const { generate } = require('../lib/proposals/comprovante');

function paginas(proposal) {
    const pdf = generate({ proposal: { id: 'recAAAAAAAAAAAAAA', cnpj: '11222333000181', numero: '02', nomeCliente: 'Empresa Fictícia',
        emailContato: 'compras@example.test', valor: 24500, formaPagamento: 'Entrada + parcela final', prazoPagamentoDias: 10, ...proposal },
    attachmentId: 'attEEEEEEEEEEEEEE', pdfHash: 'a'.repeat(64), version: 'b'.repeat(64),
    acceptedAt: Date.parse('2026-10-23T14:05:00Z'), origin: 'https://portal.example.test/' }).bytes.toString('latin1');
    return [...pdf.matchAll(/\nstream\n([\s\S]*?)endstream/g)].map(m => m[1]).filter(s => s.includes(' Tf'));
}

test('selo, CNPJ formatado e contato no resumo', () => {
    const [primeira] = paginas({ descricao: 'Ensaios fictícios' });
    assert.match(primeira, /\(Condições comerciais\) Tj/);
    assert.match(primeira, /\(Comprovante de contrato comercial\) Tj/);
    assert.match(primeira, /\(11\.222\.333\/0001-81\) Tj/);
    assert.match(primeira, /\(compras@example\.test\) Tj/);
});

test('valor ausente ou inválido não vira R$ 0,00', () => {
    for (const valor of [null, undefined, 'abc', -1]) {
        const texto = paginas({ valor }).join('\n');
        assert.doesNotMatch(texto, /R\$ 0,00/);
        assert.match(texto, /Valor total:\) Tj[\s\S]*?\(Conforme proposta\) Tj/);
    }
});

test('seções curtas não se dividem entre páginas, com descrição curta ou longa', () => {
    const longa = 'Ensaios laboratoriais geotécnicos para caracterização de solos conforme escopo técnico. '.repeat(14);
    for (const descricao of ['Ensaios fictícios', longa]) {
        const lista = paginas({ descricao });
        for (const [titulo, inicio, fim] of [
            ['Atenção', 'Este comprovante registra', 'assinatura eletrônica certificada.'],
            ['Acompanhamento', 'Acesse o Portal do Cliente', 'suas amostras.'],
            ['Documentos Integrais', 'Proposta comercial original', 'versão efetivamente aceita.'],
        ]) {
            const pagina = lista.find(p => p.includes(`(${titulo}) Tj`));
            assert.ok(pagina, `${titulo} presente`);
            assert.ok(pagina.includes(inicio) && pagina.includes(fim), `${titulo}: título e texto na mesma página`);
        }
    }
});
