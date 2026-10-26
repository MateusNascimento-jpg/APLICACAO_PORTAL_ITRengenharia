'use strict';

// Regras puras do Financeiro: normalização de valores Airtable, situação
// consolidada por contrato e montagem do JSON público (dados fictícios).

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

function proposta(id, extra = {}) {
    return { id, numero: id.slice(-3), status: 'Aceita', clienteIds: [rid('Cli')], contratoIds: [], formaPagamento: null, prazoPagamentoDias: 30, valor: null, anexos: [], ...extra };
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
const SIT = S.SITUACAO_CONTRATO;

test('situação consolidada: precedência Vencido > A Vencer > Aguardando NF > Pago, ignorando parcelas canceladas', () => {
    const c = contrato(rid('C1'), rid('P1'), C.ATIVO);
    const sit = (...status) => M.situacaoContrato(c, status.map((st, i) => fatura(rid('F' + i), c.id, st))).situacao;
    assert.equal(sit(F.PAGO, F.A_VENCER), SIT.A_VENCER, 'uma parcela paga não torna o contrato pago');
    assert.equal(sit(F.PAGO, F.VENCIDO, F.A_VENCER), SIT.VENCIDO);
    assert.equal(sit(F.PAGO, F.AGUARDANDO_NF), SIT.AGUARDANDO_NF);
    assert.equal(sit(F.A_VENCER, F.AGUARDANDO_NF), SIT.A_VENCER);
    assert.equal(sit(F.PAGO, F.PAGO), SIT.PAGO, 'Pago só com todas as aplicáveis pagas');
    assert.equal(sit(F.PAGO, F.CANCELADO), SIT.PAGO, 'parcela cancelada não é aplicável');
    assert.equal(sit(F.AGUARDANDO_NF), SIT.AGUARDANDO_NF);
    assert.equal(sit(F.CANCELADO, F.CANCELADO), SIT.EM_CONFERENCIA, 'sem parcela aplicável não há base para consolidar');
    assert.equal(sit(F.PAGO, null), SIT.EM_CONFERENCIA, 'status fora do enum impede consolidar');
    assert.equal(M.situacaoContrato(c, [fatura(rid('F1'), c.id, F.PAGO)], { parcelasRecusadas: 1 }).situacao, SIT.EM_CONFERENCIA,
        'parcela recusada pelo vínculo poderia estar em aberto: nunca "Pago"');
    assert.equal(M.situacaoContrato({ ...c, parcelasInvalidas: true }, []).situacao, SIT.EM_CONFERENCIA);
});

test('situação consolidada: status do contrato só decide cancelamento e ausência de parcelas', () => {
    const com = (status, ...faturas) => M.situacaoContrato(contrato(rid('C1'), rid('P1'), status),
        faturas.map((st, i) => fatura(rid('F' + i), rid('C1'), st)));
    assert.deepEqual(com(C.CANCELADO, F.PAGO), { situacao: SIT.CANCELADO, revisao: false });
    assert.deepEqual(com(C.CANCELADO, F.PAGO, F.VENCIDO), { situacao: SIT.CANCELADO, revisao: true }, 'cobrança aberta em contrato cancelado fica em revisão');
    assert.deepEqual(com(C.CANCELADO), { situacao: SIT.CANCELADO, revisao: false });
    assert.equal(com(C.ATIVO).situacao, SIT.EM_PREPARACAO, 'contrato ativo sem parcelas: em preparação');
    assert.equal(com(null).situacao, SIT.EM_PREPARACAO);
    assert.equal(com(C.CONCLUIDO).situacao, SIT.EM_CONFERENCIA, 'concluído sem parcelas é inconsistente');
    assert.equal(com(C.INADIMPLENTE).situacao, SIT.EM_CONFERENCIA);
    assert.equal(com(C.INADIMPLENTE, F.A_VENCER).situacao, SIT.A_VENCER, 'status contratual não é misturado ao financeiro');
    assert.equal(com(C.CONCLUIDO, F.PAGO).situacao, SIT.PAGO);
});

test('painel público: um item por contrato, sem URLs, IDs de cliente nem dados de parcela', () => {
    const anexoNf = { id: aid('Nf'), nome: 'NFSe.pdf', mime: 'application/pdf', tamanho: 5, url: 'https://v5.airtableusercontent.com/segredo' };
    const anexoProp = { id: aid('Prop'), nome: 'Proposta.pdf', mime: 'application/pdf', tamanho: 5, url: 'https://dl.airtable.com/segredo' };
    const p1 = proposta(rid('P1'), { anexos: [anexoProp], contratoIds: [rid('C1')], valor: 9000, formaPagamento: 'Entrada + parcela final' });
    const p2 = proposta(rid('P2'), { contratoIds: [rid('C2')] });
    const p3 = proposta(rid('P3'));
    const ativo = contrato(rid('C1'), p1.id, C.ATIVO, [rid('F1'), rid('F2'), rid('F3')]);
    const semFaturas = contrato(rid('C2'), p2.id, C.ATIVO);
    const painel = M.montarPainel({
        propostas: [p1, p2, p3],
        contratos: [ativo, semFaturas],
        faturas: [
            fatura(rid('F1'), ativo.id, F.PAGO, { nfse: [anexoNf], valorParcela: 3000, dataEmissaoNf: '2026-09-01' }),
            fatura(rid('F2'), ativo.id, F.A_VENCER, { valorParcela: 3000, vencimento: '2026-11-04' }),
            fatura(rid('F3'), ativo.id, F.CANCELADO, { valorParcela: 3000, nfse: [{ ...anexoNf, id: aid('NfCanc') }] }),
        ],
        atualizadoEm: '2026-10-19T12:00:00.000Z',
    });
    const json = JSON.stringify(painel);
    assert.doesNotMatch(json, /airtableusercontent|dl\.airtable\.com|segredo/);
    assert.doesNotMatch(json, new RegExp(rid('Cli')));
    assert.doesNotMatch(json, /"faturas"|"parcela"|valorParcela|valorPago|vencimento|2026-11-04|Parcela /);
    assert.equal(painel.estado, 'disponivel');
    assert.deepEqual(painel.contratos.map(c => c.id), [ativo.id, semFaturas.id]);
    const publico = painel.contratos[0];
    assert.deepEqual(Object.keys(publico).sort(), ['documentos', 'id', 'nome', 'prazoPagamentoDias', 'proposta', 'revisao', 'situacao', 'status', 'valorTotal']);
    assert.equal(publico.situacao, SIT.A_VENCER);
    assert.equal(publico.valorTotal, 9000, 'valor total = Valor da Proposta, não soma/parcela');
    assert.equal(publico.prazoPagamentoDias, 30);
    assert.deepEqual(publico.documentos.map(d => d.tipo), ['proposta', 'nfse'], 'NFSe de parcela cancelada não é listada');
    assert.deepEqual(publico.documentos[1], {
        tipo: 'nfse', rotulo: 'NFSe', registroId: rid('F1'), anexoId: aid('Nf'),
        nome: 'NFSe.pdf', mime: 'application/pdf', tamanho: 5, visualizavel: true,
    });
    assert.equal(painel.contratos[1].situacao, SIT.EM_PREPARACAO, 'contrato válido sem NF ainda aparece');
    assert.equal(painel.contratos[1].valorTotal, null, 'sem valor confiável: null (exibido como —)');
    assert.deepEqual(painel.pendencias, { propostasEmPreparacao: [{ numero: p3.numero }], itensEmConferencia: 0 });
});

test('estados da área: contrato visível prevalece; conferência e processamento só sem contratos', () => {
    const p = proposta(rid('P1'), { contratoIds: [rid('C1')] });
    const semContrato = proposta(rid('P9'));
    const montar = (args) => M.montarPainel({ atualizadoEm: null, faturas: [], contratos: [], ...args });

    // proposta aceita sem nenhum contrato cadastrado pela equipe
    const a = montar({ propostas: [semContrato] });
    assert.equal(a.estado, 'processamento');
    assert.equal(a.emProcessamento, true);
    assert.equal(a.contratos.length, 0, 'nenhuma linha inventada');

    // contrato ativo sem parcelas: aparece na lista, em preparação
    const b = montar({ propostas: [p], contratos: [contrato(rid('C1'), p.id, C.ATIVO)] });
    assert.equal(b.estado, 'disponivel');
    assert.equal(b.contratos[0].situacao, SIT.EM_PREPARACAO);

    // contrato com parcela fora do enum: linha visível em conferência
    const c1 = montar({ propostas: [p], contratos: [contrato(rid('C1'), p.id, C.ATIVO, [rid('F1')])], faturas: [fatura(rid('F1'), rid('C1'), null)] });
    assert.equal(c1.estado, 'disponivel');
    assert.equal(c1.contratos[0].situacao, SIT.EM_CONFERENCIA);

    // vínculos recusados pelo serviço e nada para listar
    const c2 = montar({ propostas: [p, semContrato], inconsistencias: 2 });
    assert.equal(c2.estado, 'conferencia', 'vínculos recusados têm prioridade sobre preparação');
    assert.equal(c2.pendencias.itensEmConferencia, 2);
    assert.equal(c2.pendencias.propostasEmPreparacao.length, 1, 'preparação continua informada');
    const invalida = proposta(rid('P8'), { vinculoContratoInvalido: true });
    assert.equal(montar({ propostas: [invalida], inconsistencias: 1 }).estado, 'conferencia');

    // contrato cancelado sem parcelas continua listado como histórico
    const cancelado = montar({ propostas: [p], contratos: [contrato(rid('C1'), p.id, C.CANCELADO)] });
    assert.equal(cancelado.estado, 'disponivel');
    assert.equal(cancelado.contratos[0].situacao, SIT.CANCELADO);

    assert.equal(M.definirEstado({ visiveis: 0, itensEmConferencia: 0, emPreparacao: 0 }), 'vazio');
    assert.equal(M.definirEstado({ visiveis: 1, itensEmConferencia: 5, emPreparacao: 5 }), 'disponivel');

    // Diagnóstico devolve só Record IDs, para log no servidor.
    const diag = M.diagnosticarPainel({
        contratos: [contrato(rid('C1'), p.id, C.CONCLUIDO, [rid('F1')]), contrato(rid('C2'), p.id, C.INADIMPLENTE)],
        faturas: [fatura(rid('F1'), rid('C1'), null)],
    });
    assert.deepEqual(diag, { parcelasNaoClassificadas: [rid('F1')], contratosSemParcelas: [rid('C2')] });
});

test('ordenação de contratos: ordem natural do nome (C2 antes de C10)', () => {
    const ps = ['P1', 'P2', 'P3'].map(x => proposta(rid(x)));
    const cs = [contrato(rid('C1'), ps[0].id, C.ATIVO), contrato(rid('C2'), ps[1].id, C.ATIVO), contrato(rid('C3'), ps[2].id, C.ATIVO)];
    cs[0].nome = 'C10'; cs[1].nome = 'C2'; cs[2].nome = 'C01';
    assert.deepEqual(M.montarPainel({ propostas: ps, contratos: cs, faturas: [] }).contratos.map(c => c.nome), ['C01', 'C2', 'C10']);
});

test('documentos fiscais: cronológicos, NFSe antes do boleto da mesma nota, nunca de parcela cancelada ou sem status', () => {
    const doc = sufixo => ({ id: aid(sufixo), nome: sufixo + '.pdf', mime: 'application/pdf', tamanho: 1, url: 'https://v5.airtableusercontent.com/x' });
    const docs = M.documentosFiscais([
        fatura(rid('F2'), rid('C1'), F.A_VENCER, { dataEmissaoNf: '2026-10-05', nfse: [doc('N2')], boleto: [doc('B2')] }),
        fatura(rid('F1'), rid('C1'), F.PAGO, { dataEmissaoNf: '2026-09-05', nfse: [doc('N1')] }),
        fatura(rid('F3'), rid('C1'), F.CANCELADO, { nfse: [doc('N3')] }),
        fatura(rid('F4'), rid('C1'), null, { nfse: [doc('N4')] }),
    ]);
    assert.deepEqual(docs.map(d => d.nome), ['N1.pdf', 'N2.pdf', 'B2.pdf']);
});
