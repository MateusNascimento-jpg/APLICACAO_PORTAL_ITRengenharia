'use strict';

// Autorização multi-CNPJ do Financeiro sobre uma base Airtable fictícia em
// memória. Cobre os cenários mínimos do handoff (06_SEGURANCA, itens 1–11).

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/financeiro/schema');
const { createFinanceiroService } = require('../lib/financeiro/service');
const { criarBaseFicticia, IDS, ANEXOS, CNPJ_A, CNPJ_B, rid } = require('./helpers/financeiro-fixtures');

const P = S.PROPOSTA;
const C = S.CONTRATOS;
const N = S.NOTAS_FISCAIS;

function preparar(opcoes = {}) {
    const base = criarBaseFicticia();
    const service = createFinanceiroService({ airtable: base.airtable, agora: () => Date.parse('2026-10-19T12:00:00.000Z'), ...opcoes });
    const logs = [];
    const registrar = (codigo, id) => logs.push(id ? `${codigo} ${id}` : codigo);
    return { base, service, logs, registrar };
}

const idsDe = painel => new Set([...painel.contratos.map(c => c.id), ...painel.faturas.map(f => f.id)]);

test('1. cliente A recebe somente os próprios contratos e faturas', async () => {
    const { base, service } = preparar();
    const painel = await service.carregarPainel(CNPJ_A);
    assert.deepEqual(painel.contratos.map(c => c.nome), ['C105-2026', 'C118-2026']);
    assert.equal(painel.faturas.length, 7);
    const ids = idsDe(painel);
    for (const alheio of [IDS.contB1, IDS.nfB1, IDS.propB1, IDS.clienteB]) assert.ok(!ids.has(alheio));
    const json = JSON.stringify(painel);
    assert.doesNotMatch(json, /C200-2026|NfseB1|BoletoB1|airtableusercontent|dl\.airtable\.com/);
    assert.doesNotMatch(json, new RegExp(`${IDS.clienteA}|${CNPJ_A}`), 'nem ID do cliente nem CNPJ no payload');
    // Nenhuma consulta pediu registros da empresa B.
    const pedidos = base.chamadas.flatMap(c => c.ids || (c.id ? [c.id] : []));
    for (const alheio of [IDS.contB1, IDS.nfB1, IDS.propB1, IDS.clienteB]) assert.ok(!pedidos.includes(alheio), alheio);
});

test('consultas usam só as tabelas e campos necessários (sem Anexo Contrato/lookup de Cliente)', async () => {
    const { base, service } = preparar();
    await service.carregarPainel(CNPJ_A);
    const tabelas = new Set(base.chamadas.filter(c => c.tabela).map(c => c.tabela));
    assert.deepEqual([...tabelas].sort(), [S.TABELAS.CLIENTES, S.TABELAS.CONTRATOS, S.TABELAS.NOTAS_FISCAIS, S.TABELAS.PROPOSTA].sort());
    const campos = base.chamadas.filter(c => c.campos).flatMap(c => c.campos);
    for (const proibido of ['fldVBdNqUGKx8S8Rb', 'fldDPP8NKcKYhb3Ml', 'fldIBRhfAMDBviLWi', 'fldBiRg2S0V1EF1K2', 'fldgMHTNCHWLPi6yO', 'fldFMHkwowNMiiPpX']) {
        assert.ok(!campos.includes(proibido), proibido);
    }
});

test('2/3. fatura ou anexo de outra empresa: negação genérica sem ler o registro alheio', async () => {
    const { base, service } = preparar();
    base.limparChamadas();
    assert.equal(await service.localizarDocumento(CNPJ_A, 'nfse', IDS.nfB1, ANEXOS.nfseB1.id), null);
    assert.ok(!base.chamadas.some(c => c.tipo === 'obter' && c.id === IDS.nfB1), 'registro de B nunca é lido');
    assert.ok(!base.chamadas.some(c => (c.ids || []).includes(IDS.nfB1)));

    assert.equal(await service.localizarDocumento(CNPJ_A, 'nfse', IDS.nfA1, ANEXOS.nfseB1.id), null, 'anexo de B em fatura de A');
    assert.equal(await service.localizarDocumento(CNPJ_A, 'boleto', IDS.nfA1, ANEXOS.nfseA1.id), null, 'anexo de NFSe pedido como boleto');
    assert.equal(await service.localizarDocumento(CNPJ_A, 'proposta', IDS.contB1, ANEXOS.propostaA1.id), null, 'contrato de B');
    assert.equal(await service.localizarDocumento(CNPJ_A, 'proposta', IDS.nfA1, ANEXOS.propostaA1.id), null, 'fatura no lugar de contrato');
    assert.equal(await service.localizarDocumento(CNPJ_A, 'contrato-formal', IDS.contA1, ANEXOS.propostaA1.id), null);
    assert.equal(await service.localizarDocumento(CNPJ_A, '__proto__', IDS.contA1, ANEXOS.propostaA1.id), null);

    const nfse = await service.localizarDocumento(CNPJ_A, 'nfse', IDS.nfA1, ANEXOS.nfseA1.id);
    assert.equal(nfse.nome, 'NFSe 0001.pdf');
    assert.equal(nfse.alvo, 'NotaFiscal');
    const proposta = await service.localizarDocumento(CNPJ_A, 'proposta', IDS.contA1, ANEXOS.propostaA1.id);
    assert.equal(proposta.nome, 'Proposta 105-2026.pdf');
    assert.equal(proposta.alvo, 'Contrato');
    const deB = await service.localizarDocumento(CNPJ_B, 'boleto', IDS.nfB1, ANEXOS.boletoB1.id);
    assert.equal(deB.nome, 'Boleto empresa B.pdf');
});

test('4. IDs misturados: fatura listada no contrato de A mas ligada ao contrato de B é negada', async () => {
    const { base, service, logs, registrar } = preparar();
    base.registro(S.TABELAS.NOTAS_FISCAIS, IDS.nfA2).fields[N.CONTRATO] = [IDS.contB1];
    const painel = await service.carregarPainel(CNPJ_A, { registrar });
    assert.ok(!idsDe(painel).has(IDS.nfA2));
    assert.ok(logs.includes(`FIN_FATURA_VINCULO_INCONSISTENTE ${IDS.nfA2}`));
    assert.equal(await service.localizarDocumento(CNPJ_A, 'boleto', IDS.nfA2, ANEXOS.boletoA2.id), null);

    // Fatura com dois contratos também é negada.
    base.registro(S.TABELAS.NOTAS_FISCAIS, IDS.nfA3).fields[N.CONTRATO] = [IDS.contA1, IDS.contB1];
    assert.ok(!idsDe(await service.carregarPainel(CNPJ_A)).has(IDS.nfA3));
});

test('5. CNPJ duplicado em Clientes: nega lista e documentos e registra código interno', async () => {
    const { base, service, logs, registrar } = preparar();
    base.tabelas[S.TABELAS.CLIENTES].push({ id: rid('CliDup'), fields: { [S.CLIENTES.CNPJ]: CNPJ_A } });
    assert.equal(await service.carregarPainel(CNPJ_A, { registrar }), null);
    assert.equal(await service.localizarDocumento(CNPJ_A, 'nfse', IDS.nfA1, ANEXOS.nfseA1.id, registrar), null);
    assert.ok(logs.includes('FIN_CLIENTE_DUPLICADO'));
    assert.ok(!logs.join(' ').includes(CNPJ_A), 'CNPJ não vai para o log');
});

test('6. contrato com propostas de empresas diferentes ou proposta alheia é bloqueado', async () => {
    const { base, service, logs, registrar } = preparar();
    base.registro(S.TABELAS.CONTRATOS, IDS.contA1).fields[C.PROPOSTA] = [IDS.propA1, IDS.propB1];
    let painel = await service.carregarPainel(CNPJ_A, { registrar });
    assert.ok(!idsDe(painel).has(IDS.contA1));
    assert.ok(!painel.faturas.some(f => f.contratoId === IDS.contA1));
    assert.ok(logs.includes(`FIN_CONTRATO_VINCULO_AMBIGUO ${IDS.contA1}`));
    // A proposta 105 TEM contrato, só que inconsistente: conta como conferência, não como preparação.
    assert.deepEqual(painel.pendencias.propostasEmPreparacao.map(p => p.numero), ['131-2026']);
    assert.ok(painel.pendencias.itensEmConferencia >= 1);

    // Proposta de A aponta (por erro) para o contrato de B: o contrato não aparece para A.
    base.registro(S.TABELAS.CONTRATOS, IDS.contA1).fields[C.PROPOSTA] = [IDS.propA1];
    base.registro(S.TABELAS.PROPOSTA, IDS.propA1).fields[P.CONTRATOS] = [IDS.contA1, IDS.contB1];
    painel = await service.carregarPainel(CNPJ_A, { registrar });
    assert.ok(!idsDe(painel).has(IDS.contB1));
    assert.ok(!idsDe(painel).has(IDS.nfB1));
    assert.ok(logs.includes(`FIN_CONTRATO_PROPOSTA_NAO_AUTORIZADA ${IDS.contB1}`));
});

test('7. contrato válido sem nota fiscal: estado de preparação, não “zero faturas”', async () => {
    const { base, service } = preparar();
    base.registro(S.TABELAS.CONTRATOS, IDS.contB1).fields[C.PARCELAS] = [];
    const painel = await service.carregarPainel(CNPJ_B);
    assert.equal(painel.estado, 'processamento');
    assert.equal(painel.emProcessamento, true);
    assert.deepEqual(painel.pendencias.contratosEmPreparacao, [{ nome: 'C200-2026' }]);
    assert.equal(painel.pendencias.itensEmConferencia, 0);
    assert.equal(painel.faturas.length, 0);
});

test('8. proposta não aceita não habilita o Financeiro, inclusive se mudou após o cache da lista', async () => {
    const { base, service } = preparar();
    for (const id of [IDS.propA1, IDS.propA2, IDS.propA3]) base.registro(S.TABELAS.PROPOSTA, id).fields[P.STATUS] = 'Em Análise pelo Cliente';
    assert.equal(await service.carregarPainel(CNPJ_A), null);

    // A lista de propostas (cache) ainda diz "Aceita", mas o registro atual não.
    const outro = preparar();
    const listar = outro.base.airtable.listarPropostasPorCnpj;
    outro.base.airtable.listarPropostasPorCnpj = async cnpj => {
        const r = await listar(cnpj);
        return { ...r, propostas: r.propostas.map(p => ({ ...p, status: 'Aceita' })) };
    };
    for (const id of [IDS.propA1, IDS.propA2, IDS.propA3]) outro.base.registro(S.TABELAS.PROPOSTA, id).fields[P.STATUS] = 'Rejeitada';
    assert.equal(await outro.service.carregarPainel(CNPJ_A), null);
    assert.equal(await outro.service.localizarDocumento(CNPJ_A, 'nfse', IDS.nfA1, ANEXOS.nfseA1.id), null);

    // Proposta "Aceita" ligada a dois clientes não autoriza nenhum deles.
    const terceiro = preparar();
    terceiro.base.registro(S.TABELAS.PROPOSTA, IDS.propB1).fields[P.CLIENTE] = [IDS.clienteB, IDS.clienteA];
    assert.equal(await terceiro.service.carregarPainel(CNPJ_B), null);
});

test('9. contrato cancelado: parcela paga continua em Pagas; cobrança pendente vira revisão', async () => {
    const { service } = preparar();
    const painel = await service.carregarPainel(CNPJ_A);
    const porId = Object.fromEntries(painel.faturas.map(f => [f.id, f]));
    assert.equal(porId[IDS.nfA5].aba, 'pagas');
    assert.equal(porId[IDS.nfA5].status, 'Pago');
    assert.equal(porId[IDS.nfA6].aba, 'canceladas');
    assert.equal(porId[IDS.nfA6].revisao, true);
    assert.equal(porId[IDS.nfA6].status, 'A Vencer', 'status de origem preservado');
    assert.ok(!painel.faturas.some(f => f.aba === 'a-pagar' && f.contratoId === IDS.contA2));
    assert.equal(porId[IDS.nfA7].aba, 'canceladas');
    assert.equal(porId[IDS.nfA4].aba, 'proximas');
    assert.equal(porId[IDS.nfA4].vencimento, null, 'sem NF não há vencimento inventado');
    assert.equal(porId[IDS.nfA2].diferenca, 3000);
});

test('11. falha do Airtable entre duas consultas: erro explícito, nada servido da memória', async () => {
    const { base, service } = preparar();
    assert.ok(await service.carregarPainel(CNPJ_A));
    base.falhar(true);
    await assert.rejects(service.carregarPainel(CNPJ_A), /AIRTABLE_OFFLINE/);
    base.falhar(false);
    assert.ok(await service.carregarPainel(CNPJ_A));
});

test('sem cache de painel: cada chamada relê propostas, contratos e faturas no Airtable', async () => {
    const { base, service } = preparar();
    for (let i = 0; i < 3; i += 1) {
        base.limparChamadas();
        await service.carregarPainel(CNPJ_A);
        const tabelas = base.chamadas.filter(c => c.tipo === 'listar').map(c => c.tabela);
        assert.ok(tabelas.includes(S.TABELAS.PROPOSTA) && tabelas.includes(S.TABELAS.CONTRATOS) && tabelas.includes(S.TABELAS.NOTAS_FISCAIS), `chamada ${i + 1}`);
        assert.ok(base.chamadas.some(c => c.tipo === 'obter' && c.tabela === S.TABELAS.CLIENTES), 'cadastro do cliente relido');
    }
});

// Achado 1 da auditoria: alterações feitas no Airtable logo após uma consulta
// ("cache quente") precisam valer já na consulta seguinte, sem esperar TTL.
test('Achado 1 — reassociação de contrato para outra empresa vale na consulta seguinte (lista, documento e titularidade)', async () => {
    const { base, service, logs, registrar } = preparar();
    const antes = await service.carregarPainel(CNPJ_A);
    assert.ok(idsDe(antes).has(IDS.contA1));

    // Só o campo do contrato muda (como na reprodução da auditoria).
    base.registro(S.TABELAS.CONTRATOS, IDS.contA1).fields[C.PROPOSTA] = [IDS.propB1];
    const depois = await service.carregarPainel(CNPJ_A, { registrar });
    for (const id of [IDS.contA1, IDS.nfA1, IDS.nfA2, IDS.nfA3, IDS.nfA4, IDS.nfA7]) assert.ok(!idsDe(depois).has(id), id);
    assert.ok(logs.includes(`FIN_CONTRATO_PROPOSTA_NAO_AUTORIZADA ${IDS.contA1}`));
    assert.equal(await service.localizarDocumento(CNPJ_A, 'nfse', IDS.nfA1, ANEXOS.nfseA1.id), null);
    assert.equal(await service.localizarDocumento(CNPJ_A, 'proposta', IDS.contA1, ANEXOS.propostaA1.id), null);

    // Troca completa de titularidade (os dois lados do vínculo): passa a ser de B, some de A.
    base.registro(S.TABELAS.PROPOSTA, IDS.propA1).fields[P.CONTRATOS] = [];
    base.registro(S.TABELAS.PROPOSTA, IDS.propB1).fields[P.CONTRATOS] = [IDS.contB1, IDS.contA1];
    const deA = await service.carregarPainel(CNPJ_A);
    const deB = await service.carregarPainel(CNPJ_B);
    assert.ok(!idsDe(deA).has(IDS.contA1));
    assert.ok(idsDe(deB).has(IDS.contA1), 'nova titular passa a ver imediatamente');
    assert.ok((await service.localizarDocumento(CNPJ_B, 'nfse', IDS.nfA1, ANEXOS.nfseA1.id)), 'documento acompanha o vínculo atual');
});

test('Achado 1 — vínculos removidos ou alterados entre duas consultas seguidas', async () => {
    const cenarios = [
        ['fatura movida para contrato de outra empresa', b => { b.registro(S.TABELAS.NOTAS_FISCAIS, IDS.nfA2).fields[N.CONTRATO] = [IDS.contB1]; }, p => !idsDe(p).has(IDS.nfA2)],
        ['fatura retirada das Parcelas do contrato', b => {
            const f = b.registro(S.TABELAS.CONTRATOS, IDS.contA1).fields;
            f[C.PARCELAS] = f[C.PARCELAS].filter(id => id !== IDS.nfA3);
        }, p => !idsDe(p).has(IDS.nfA3)],
        ['vínculo Contrato → Proposta removido', b => { b.registro(S.TABELAS.CONTRATOS, IDS.contA2).fields[C.PROPOSTA] = []; },
            p => !idsDe(p).has(IDS.contA2) && !idsDe(p).has(IDS.nfA5) && p.pendencias.itensEmConferencia >= 1],
        ['proposta passou para outro cliente', b => { b.registro(S.TABELAS.PROPOSTA, IDS.propA2).fields[P.CLIENTE] = [IDS.clienteB]; },
            p => !idsDe(p).has(IDS.contA2) && !idsDe(p).has(IDS.nfA6)],
        ['proposta deixou de estar Aceita', b => { b.registro(S.TABELAS.PROPOSTA, IDS.propA1).fields[P.STATUS] = 'Rejeitada'; },
            p => !idsDe(p).has(IDS.contA1) && !idsDe(p).has(IDS.nfA1)],
        ['todas as propostas deixaram de estar Aceitas', b => {
            for (const id of [IDS.propA1, IDS.propA2, IDS.propA3]) b.registro(S.TABELAS.PROPOSTA, id).fields[P.STATUS] = 'Expirada';
        }, p => p === null],
        ['CNPJ do cadastro alterado', b => { b.registro(S.TABELAS.CLIENTES, IDS.clienteA).fields[S.CLIENTES.CNPJ] = '99.888.777/0001-66'; }, p => p === null],
    ];
    for (const [nome, alterar, conferir] of cenarios) {
        const { base, service } = preparar();
        assert.ok(await service.carregarPainel(CNPJ_A), `${nome}: consulta inicial`);
        alterar(base);
        assert.ok(conferir(await service.carregarPainel(CNPJ_A)), nome);
    }
});

test('cadastro do cliente divergente na leitura atual nega o acesso', async () => {
    const { base, service, logs, registrar } = preparar();
    const getRegistro = base.airtable.obterRegistro;
    base.airtable.obterRegistro = async (tabela, id) => {
        const r = await getRegistro(tabela, id);
        if (tabela === S.TABELAS.CLIENTES) r.fields[S.CLIENTES.CNPJ] = CNPJ_B;
        return r;
    };
    assert.equal(await service.carregarPainel(CNPJ_A, { registrar }), null);
    assert.ok(logs.includes('FIN_CLIENTE_DIVERGENTE'));
});

test('entradas inválidas e limites: CNPJ malformado, IDs fora do padrão e teto de contratos', async () => {
    const { base, service } = preparar();
    assert.equal(await service.carregarPainel('123'), null);
    assert.equal(await service.carregarPainel(''), null);
    assert.equal(await service.localizarDocumento(CNPJ_A, 'nfse', "rec' OR 1=1", ANEXOS.nfseA1.id), null);
    assert.equal(await service.localizarDocumento(CNPJ_A, 'nfse', IDS.nfA1, '../../x'), null);
    assert.equal(base.chamadas.length, 0, 'nada é consultado com entrada inválida');

    const ids = Array.from({ length: 201 }, (_, i) => rid('Muitos' + i));
    base.registro(S.TABELAS.PROPOSTA, IDS.propA1).fields[P.CONTRATOS] = ids;
    await assert.rejects(service.carregarPainel(CNPJ_A), /FINANCE_LIMIT/);
});

test('consultas por Record ID são feitas em lotes e só aceitam registros pedidos', async () => {
    const { base, service } = preparar();
    const ids = Array.from({ length: 85 }, (_, i) => rid('Lote' + i));
    base.registro(S.TABELAS.PROPOSTA, IDS.propB1).fields[P.CONTRATOS] = [IDS.contB1, ...ids];
    const listar = base.airtable.listarRegistros;
    base.airtable.listarRegistros = async (tabela, campos, formula) => {
        const r = await listar(tabela, campos, formula);
        // Um registro "extra" que não foi pedido nunca pode entrar no resultado.
        if (tabela === S.TABELAS.CONTRATOS) r.push({ id: IDS.contA1, fields: base.registro(S.TABELAS.CONTRATOS, IDS.contA1).fields });
        return r;
    };
    const painel = await service.carregarPainel(CNPJ_B);
    assert.deepEqual(painel.contratos.map(c => c.id), [IDS.contB1]);
    const lotes = base.chamadas.filter(c => c.tipo === 'listar' && c.tabela === S.TABELAS.CONTRATOS);
    assert.equal(lotes.length, 3, '86 IDs em lotes de 40');
    assert.ok(lotes.every(l => l.ids.length <= 40));
});

// Achado 3 da auditoria: "processamento" só quando realmente falta contrato ou
// parcela; registros recebidos mas inconsistentes aparecem como conferência.
test('Achado 3 — estados distintos: processamento, conferência e disponível', async () => {
    const casos = [
        ['proposta aceita sem contrato', b => { b.registro(S.TABELAS.PROPOSTA, IDS.propB1).fields[P.CONTRATOS] = []; }, 'processamento', null],
        ['contrato ativo sem parcelas', b => { b.registro(S.TABELAS.CONTRATOS, IDS.contB1).fields[C.PARCELAS] = []; }, 'processamento', null],
        ['parcela com status fora da lista oficial', b => { b.registro(S.TABELAS.NOTAS_FISCAIS, IDS.nfB1).fields[N.STATUS_PAGAMENTO] = 'Em análise'; }, 'conferencia', 'FIN_PARCELA_NAO_CLASSIFICADA'],
        ['Aguardando NF em contrato Concluído', b => {
            b.registro(S.TABELAS.NOTAS_FISCAIS, IDS.nfB1).fields[N.STATUS_PAGAMENTO] = 'Aguardando Emissão da NF';
            b.registro(S.TABELAS.CONTRATOS, IDS.contB1).fields[C.STATUS] = 'Concluído';
        }, 'conferencia', 'FIN_PARCELA_NAO_CLASSIFICADA'],
        ['contrato com vínculo ambíguo', b => { b.registro(S.TABELAS.CONTRATOS, IDS.contB1).fields[C.PROPOSTA] = [IDS.propB1, IDS.propA1]; }, 'conferencia', 'FIN_CONTRATO_VINCULO_AMBIGUO'],
        ['fatura com vínculo inconsistente', b => { b.registro(S.TABELAS.NOTAS_FISCAIS, IDS.nfB1).fields[N.CONTRATO] = [IDS.contA1]; }, 'conferencia', 'FIN_FATURA_VINCULO_INCONSISTENTE'],
        ['fatura listada mas inexistente', b => { b.registro(S.TABELAS.CONTRATOS, IDS.contB1).fields[C.PARCELAS] = [rid('Sumida')]; }, 'conferencia', 'FIN_FATURA_AUSENTE'],
        ['contrato listado mas inexistente', b => { b.registro(S.TABELAS.PROPOSTA, IDS.propB1).fields[P.CONTRATOS] = [rid('ContSumido')]; }, 'conferencia', 'FIN_CONTRATO_AUSENTE'],
        ['contrato Inadimplente sem parcelas', b => {
            const f = b.registro(S.TABELAS.CONTRATOS, IDS.contB1).fields;
            f[C.STATUS] = 'Inadimplente';
            f[C.PARCELAS] = [];
        }, 'conferencia', 'FIN_CONTRATO_SEM_PARCELAS_INCONSISTENTE'],
        ['fatura válida', () => {}, 'disponivel', null],
    ];
    for (const [nome, alterar, estado, codigo] of casos) {
        const { base, service, logs, registrar } = preparar();
        alterar(base);
        const painel = await service.carregarPainel(CNPJ_B, { registrar });
        assert.equal(painel.estado, estado, nome);
        assert.equal(painel.emProcessamento, estado === 'processamento', nome);
        if (estado === 'conferencia') assert.ok(painel.pendencias.itensEmConferencia >= 1, nome);
        if (estado === 'processamento') assert.equal(painel.pendencias.itensEmConferencia, 0, nome);
        if (codigo) assert.ok(logs.some(l => l.startsWith(codigo + ' rec')), `${nome}: log ${codigo} com Record ID`);
        assert.ok(!logs.join(' ').includes(CNPJ_B), `${nome}: CNPJ fora do log`);
        assert.doesNotMatch(JSON.stringify(painel), /rec0{5,}Sumid|ContSumido|Em análise/, `${nome}: nada do item inconsistente vai ao cliente`);
    }
});

test('Achado 3 — conferência convive com dados disponíveis e é avisada (sem detalhes)', async () => {
    const { base, service } = preparar();
    base.registro(S.TABELAS.NOTAS_FISCAIS, IDS.nfA3).fields[N.STATUS_PAGAMENTO] = 'Status novo';
    const painel = await service.carregarPainel(CNPJ_A);
    assert.equal(painel.estado, 'disponivel');
    assert.equal(painel.pendencias.itensEmConferencia, 1);
    assert.ok(!idsDe(painel).has(IDS.nfA3));
});

test('Achado 1 — lista de propostas desatualizada (cache de 30 s do Portal) só sugere candidatos, nunca autoriza', async () => {
    const { base, service } = preparar();
    // Congela a resposta de listarPropostasPorCnpj como se viesse do cache.
    const congelada = await base.airtable.listarPropostasPorCnpj(CNPJ_A);
    base.airtable.listarPropostasPorCnpj = async () => congelada;
    assert.ok(idsDe(await service.carregarPainel(CNPJ_A)).has(IDS.contA2));

    base.registro(S.TABELAS.PROPOSTA, IDS.propA2).fields[P.CLIENTE] = [IDS.clienteB];
    const painel = await service.carregarPainel(CNPJ_A);
    assert.ok(!idsDe(painel).has(IDS.contA2), 'proposta que mudou de cliente é recusada pela leitura atual');
    assert.ok(!idsDe(painel).has(IDS.nfA5) && !idsDe(painel).has(IDS.nfA6));
    assert.equal(await service.localizarDocumento(CNPJ_A, 'proposta', IDS.contA2, ANEXOS.propostaA2.id), null);
});
