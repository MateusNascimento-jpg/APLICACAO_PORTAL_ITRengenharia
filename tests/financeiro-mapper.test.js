'use strict';

// Regras puras do Financeiro: normalização de valores Airtable, classificação
// das quatro abas, ordenação e montagem do JSON público (dados fictícios).

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/financeiro/schema');
const M = require('../lib/financeiro/mapper');
const { rid, aid } = require('./helpers/financeiro-fixtures');

const F = S.STATUS_FATURA;
const C = S.STATUS_CONTRATO;

test('vínculos: aceita string ou { id }, e qualquer item malformado invalida a lista', () => {
    assert.deepEqual(M.linksValidos([rid('A'), { id: rid('B') }]), [rid('A'), rid('B')]);
    assert.deepEqual(M.linksValidos(undefined), []);
    assert.deepEqual(M.linksValidos([rid('A'), rid('A')]), [rid('A')]);
    assert.equal(M.linksValidos([rid('A'), 'recCURTO']), null);
    assert.equal(M.linksValidos([rid('A'), { name: 'Empresa' }]), null);
    assert.equal(M.linksValidos("rec00000000000001' OR TRUE()"), null);
    assert.equal(M.linksValidos('rec00000000000001'), null);
});

test('valores monetários: finitos, não negativos, lookup único; erros de fórmula viram null', () => {
    assert.equal(M.moeda(1500), 1500);
    assert.equal(M.moeda(0), 0);
    assert.equal(M.moeda([4500]), 4500);
    assert.equal(M.moeda([4500, 4500]), 4500);
    assert.equal(M.moeda([4500, 3000]), null, 'lookup divergente não é somado nem escolhido');
    assert.equal(M.moeda(-10), null);
    assert.equal(M.moeda(Number.NaN), null);
    assert.equal(M.moeda(Infinity), null);
    assert.equal(M.moeda(null), null);
    assert.equal(M.moeda('4500'), null);
    assert.equal(M.moeda({ specialValue: 'NaN' }), null);
    assert.equal(M.moeda({ error: '#ERROR!' }), null);
    assert.equal(M.moeda(1333.335), 1333.34);
});

test('prazo em dias: inteiro não negativo; nunca vira data', () => {
    assert.equal(M.dias(30), 30);
    assert.equal(M.dias([15]), 15);
    assert.equal(M.dias(0), 0);
    assert.equal(M.dias(-1), null);
    assert.equal(M.dias(2.5), null);
    assert.equal(M.dias('30'), null);
    assert.equal(M.dias(99999), null);
});

test('datas: AAAA-MM-DD de calendário, sem deslocamento de fuso e sem datas impossíveis', () => {
    assert.equal(M.dataIso('2026-10-05'), '2026-10-05');
    assert.equal(M.dataIso('2026-10-05T00:00:00.000Z'), '2026-10-05');
    assert.equal(M.dataIso('2026-10-05T03:00:00.000-03:00'), '2026-10-05');
    assert.equal(M.dataIso(['2026-11-04T00:00:00.000Z']), '2026-11-04');
    assert.equal(M.dataIso('2026-02-30'), null);
    assert.equal(M.dataIso('05/10/2026'), null);
    assert.equal(M.dataIso({ error: '#ERROR!' }), null);
    assert.equal(M.dataIso(''), null);
});

test('anexos: somente IDs att válidos, URL presente, tipo permitido e sem duplicidade', () => {
    const ok = { id: aid('Ok1'), filename: 'NFSe.pdf', type: 'application/pdf', size: 10, url: 'https://v5.airtableusercontent.com/x' };
    const anexos = M.anexosSeguros([
        ok,
        { ...ok },
        { id: 'attCURTO', filename: 'x.pdf', type: 'application/pdf', url: 'https://v5.airtableusercontent.com/y' },
        { id: aid('SemUrl'), filename: 'x.pdf', type: 'application/pdf' },
        { id: aid('Html'), filename: 'pagina.html', type: 'text/html', url: 'https://v5.airtableusercontent.com/z' },
        { id: aid('Zip'), filename: 'pacote.zip', type: 'application/zip', url: 'https://v5.airtableusercontent.com/w' },
        { id: aid('Xml'), filename: '../../etc/nfse.xml', type: 'text/xml; charset=utf-8', url: 'https://v5.airtableusercontent.com/v' },
        { id: aid('SemNome'), filename: '', type: 'image/png', url: 'https://v5.airtableusercontent.com/u' },
        null,
        'texto',
    ], 'NFSe');
    assert.deepEqual(anexos.map(a => a.id), [aid('Ok1'), aid('Xml'), aid('SemNome')]);
    assert.equal(anexos[1].nome, '.._.._etc_nfse.xml', 'separadores de caminho são neutralizados');
    assert.equal(anexos[1].mime, 'text/xml');
    assert.equal(anexos[2].nome, 'NFSe.png');
    assert.equal(M.anexosSeguros('não é lista', 'NFSe').length, 0);
});

test('classificação: matriz completa de status da fatura × status do contrato', () => {
    const esperado = {
        [F.AGUARDANDO_NF]: { Ativo: 'proximas', Concluído: null, Cancelado: 'canceladas', Inadimplente: null, desconhecido: null },
        [F.A_VENCER]: { Ativo: 'a-pagar', Concluído: 'a-pagar', Cancelado: 'canceladas', Inadimplente: 'a-pagar', desconhecido: 'a-pagar' },
        [F.VENCIDO]: { Ativo: 'a-pagar', Concluído: 'a-pagar', Cancelado: 'canceladas', Inadimplente: 'a-pagar', desconhecido: 'a-pagar' },
        [F.PAGO]: { Ativo: 'pagas', Concluído: 'pagas', Cancelado: 'pagas', Inadimplente: 'pagas', desconhecido: 'pagas' },
        [F.CANCELADO]: { Ativo: 'canceladas', Concluído: 'canceladas', Cancelado: 'canceladas', Inadimplente: 'canceladas', desconhecido: 'canceladas' },
    };
    for (const [statusFatura, porContrato] of Object.entries(esperado)) {
        for (const [statusContrato, aba] of Object.entries(porContrato)) {
            const resultado = M.classificarFatura(statusFatura, statusContrato === 'desconhecido' ? null : statusContrato);
            assert.equal(resultado.aba, aba, `${statusFatura} / ${statusContrato}`);
        }
    }
    assert.equal(M.classificarFatura(F.A_VENCER, C.CANCELADO).revisao, true);
    assert.equal(M.classificarFatura(F.VENCIDO, C.CANCELADO).revisao, true);
    assert.equal(M.classificarFatura(F.PAGO, C.CANCELADO).revisao, false, 'paga antes do cancelamento continua paga');
    assert.equal(M.classificarFatura('Paga', C.ATIVO).aba, null, 'grafia diferente não é adivinhada');
    assert.equal(M.classificarFatura(null, C.ATIVO).aba, null);
});

test('diferença calculada só existe em pagamento parcial confiável', () => {
    assert.equal(M.diferencaCalculada(4500, 1500), 3000);
    assert.equal(M.diferencaCalculada(4500, 4500), null);
    assert.equal(M.diferencaCalculada(4500, 5000), null);
    assert.equal(M.diferencaCalculada(4500, 0), null);
    assert.equal(M.diferencaCalculada(null, 100), null);
    assert.equal(M.diferencaCalculada(100.1, 0.2), 99.9);
});

function proposta(id, extra = {}) {
    return { id, numero: id.slice(-3), status: 'Aceita', clienteIds: [rid('Cli')], contratoIds: [], formaPagamento: null, prazoPagamentoDias: 30, anexos: [], ...extra };
}
function contrato(id, propostaId, status, parcelaIds = []) {
    return { id, nome: 'C-' + id.slice(-3), status, propostaIds: [propostaId], parcelaIds, prazoPagamentoDias: null };
}
function fatura(id, contratoId, status, extra = {}) {
    return {
        id, parcela: 'Parcela ' + id.slice(-2), contratoIds: [contratoId], status,
        valorParcela: 100, valorPago: null, dataEmissaoNf: null, prazoPagamentoDias: null,
        vencimento: null, dataPagamento: null, nfse: [], boleto: [], ...extra,
    };
}

test('ordenação: vencidas primeiro, vencimento ascendente; pagas por data desc com ausência por último', () => {
    const p = proposta(rid('P1'));
    const c = contrato(rid('C1'), p.id, C.ATIVO);
    const painel = M.montarPainel({
        propostas: [p],
        contratos: [c],
        faturas: [
            fatura(rid('F01'), c.id, F.A_VENCER, { vencimento: '2026-10-01' }),
            fatura(rid('F02'), c.id, F.VENCIDO, { vencimento: '2026-11-01' }),
            fatura(rid('F03'), c.id, F.A_VENCER, { vencimento: null }),
            fatura(rid('F04'), c.id, F.VENCIDO, { vencimento: '2026-09-01' }),
            fatura(rid('F05'), c.id, F.PAGO, { dataPagamento: '2026-01-10' }),
            fatura(rid('F06'), c.id, F.PAGO, { dataPagamento: null }),
            fatura(rid('F07'), c.id, F.PAGO, { dataPagamento: '2026-05-10' }),
            fatura(rid('F08'), c.id, F.AGUARDANDO_NF, { parcela: 'Parcela 10' }),
            fatura(rid('F09'), c.id, F.AGUARDANDO_NF, { parcela: 'Parcela 2' }),
        ],
        atualizadoEm: '2026-10-19T12:00:00.000Z',
    });
    const ids = aba => painel.faturas.filter(f => f.aba === aba).map(f => f.id.slice(-3));
    assert.deepEqual(ids('a-pagar'), ['F04', 'F02', 'F01', 'F03']);
    assert.deepEqual(ids('pagas'), ['F07', 'F05', 'F06']);
    assert.deepEqual(ids('proximas'), ['F09', 'F08'], 'ordem natural da parcela (2 antes de 10)');
    assert.equal(painel.emProcessamento, false);
});

test('painel público: sem URLs, sem IDs de cliente e com estados corretos', () => {
    const anexoNf = { id: aid('Nf'), nome: 'NFSe.pdf', mime: 'application/pdf', tamanho: 5, url: 'https://v5.airtableusercontent.com/segredo' };
    const anexoProp = { id: aid('Prop'), nome: 'Proposta.pdf', mime: 'application/pdf', tamanho: 5, url: 'https://dl.airtable.com/segredo' };
    const p1 = proposta(rid('P1'), { anexos: [anexoProp], contratoIds: [rid('C1')] });
    const p2 = proposta(rid('P2'), { contratoIds: [rid('C2')] });
    const p3 = proposta(rid('P3'));
    const ativo = contrato(rid('C1'), p1.id, C.ATIVO, [rid('F1'), rid('F2')]);
    const semFaturas = contrato(rid('C2'), p2.id, C.ATIVO);
    const painel = M.montarPainel({
        propostas: [p1, p2, p3],
        contratos: [ativo, semFaturas],
        faturas: [fatura(rid('F1'), ativo.id, F.A_VENCER, { nfse: [anexoNf] }), fatura(rid('F2'), ativo.id, 'Status novo')],
        atualizadoEm: '2026-10-19T12:00:00.000Z',
    });
    const json = JSON.stringify(painel);
    assert.doesNotMatch(json, /airtableusercontent|dl\.airtable\.com|segredo|Status novo/);
    assert.doesNotMatch(json, new RegExp(rid('Cli')));
    assert.equal(painel.estado, 'disponivel');
    assert.equal(painel.faturas.length, 1, 'status desconhecido não entra em aba');
    assert.equal(painel.pendencias.itensEmConferencia, 1);
    assert.deepEqual(painel.pendencias.propostasEmPreparacao, [{ numero: p3.numero }]);
    assert.deepEqual(painel.pendencias.contratosEmPreparacao, [{ nome: semFaturas.nome }]);
    assert.deepEqual(painel.faturas[0].documentos[0], {
        tipo: 'nfse', rotulo: 'NFSe', registroId: rid('F1'), anexoId: aid('Nf'),
        nome: 'NFSe.pdf', mime: 'application/pdf', tamanho: 5, visualizavel: true,
    });
    assert.equal(painel.contratos.find(c => c.id === ativo.id).documentos[0].rotulo, 'Proposta comercial');
});

test('estados (a) proposta sem contrato, (b) contrato sem parcelas, (c) inconsistências, (d) nada aplicável', () => {
    const p = proposta(rid('P1'), { contratoIds: [rid('C1')] });
    const semContrato = proposta(rid('P9'));
    const montar = (args) => M.montarPainel({ atualizadoEm: null, faturas: [], contratos: [], ...args });

    // (a) proposta aceita sem nenhum contrato vinculado
    const a = montar({ propostas: [semContrato] });
    assert.equal(a.estado, 'processamento');
    assert.equal(a.emProcessamento, true);

    // (b) contrato ativo (ou sem status) sem nenhuma parcela
    for (const status of [C.ATIVO, null]) {
        const b = montar({ propostas: [p], contratos: [contrato(rid('C1'), p.id, status)] });
        assert.equal(b.estado, 'processamento', String(status));
        assert.deepEqual(b.pendencias.contratosEmPreparacao.length, 1);
    }

    // (c) dados recebidos mas impróprios: nunca mascarados como processamento
    const c1 = montar({ propostas: [p], contratos: [contrato(rid('C1'), p.id, C.ATIVO, [rid('F1')])], faturas: [fatura(rid('F1'), rid('C1'), 'Paga')] });
    assert.equal(c1.estado, 'conferencia', 'parcela não classificável');
    const c2 = montar({ propostas: [p, semContrato], inconsistencias: 2 });
    assert.equal(c2.estado, 'conferencia', 'vínculos recusados pelo serviço têm prioridade sobre preparação');
    assert.equal(c2.pendencias.itensEmConferencia, 2);
    assert.equal(c2.pendencias.propostasEmPreparacao.length, 1, 'preparação continua informada');
    for (const status of [C.CONCLUIDO, C.INADIMPLENTE]) {
        const c3 = montar({ propostas: [p], contratos: [contrato(rid('C1'), p.id, status)] });
        assert.equal(c3.estado, 'conferencia', `${status} sem parcelas`);
        assert.equal(c3.pendencias.contratosEmPreparacao.length, 0);
    }
    const invalida = proposta(rid('P8'), { vinculoContratoInvalido: true });
    assert.equal(montar({ propostas: [invalida], inconsistencias: 1 }).estado, 'conferencia');

    // contrato cancelado sem parcelas é histórico visível (Canceladas)
    assert.equal(montar({ propostas: [p], contratos: [contrato(rid('C1'), p.id, C.CANCELADO)] }).estado, 'disponivel');

    // (d) nada aplicável
    assert.equal(M.definirEstado({ visiveis: 0, itensEmConferencia: 0, emPreparacao: 0 }), 'vazio');
    assert.equal(M.definirEstado({ visiveis: 1, itensEmConferencia: 5, emPreparacao: 5 }), 'disponivel');

    // Diagnóstico devolve só Record IDs, para log no servidor.
    const diag = M.diagnosticarPainel({
        contratos: [contrato(rid('C1'), p.id, C.CONCLUIDO, [rid('F1')]), contrato(rid('C2'), p.id, C.INADIMPLENTE)],
        faturas: [fatura(rid('F1'), rid('C1'), F.AGUARDANDO_NF)],
    });
    assert.deepEqual(diag, { parcelasNaoClassificadas: [rid('F1')], contratosSemParcelas: [rid('C2')] });
});
