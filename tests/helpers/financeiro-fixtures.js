'use strict';

// Base Airtable FINANCEIRA em memória, com dados 100% fictícios (CNPJs de
// exemplo, valores e nomes inventados). Reproduz o formato REST com
// returnFieldsByFieldId=true e registra cada chamada para os testes.

const S = require('../../lib/financeiro/schema');

const P = S.PROPOSTA;
const C = S.CONTRATOS;
const N = S.NOTAS_FISCAIS;

const CNPJ_A = '11222333000181';
const CNPJ_B = '44555666000172';

function rid(sufixo) {
    return 'rec' + String(sufixo).padStart(14, '0');
}

function aid(sufixo) {
    return 'att' + String(sufixo).padStart(14, '0');
}

function anexo(sufixo, nome, tipo = 'application/pdf') {
    const id = aid(sufixo);
    return { id, filename: nome, type: tipo, size: 48213, url: `https://v5.airtableusercontent.com/ficticio/${id}` };
}

const IDS = {
    clienteA: rid('CliA'),
    clienteB: rid('CliB'),
    propA1: rid('PropA1'),
    propA2: rid('PropA2'),
    propA3: rid('PropA3'),
    propA4: rid('PropA4'),
    propB1: rid('PropB1'),
    contA1: rid('ContA1'),
    contA2: rid('ContA2'),
    contB1: rid('ContB1'),
    nfA1: rid('NfA1'),
    nfA2: rid('NfA2'),
    nfA3: rid('NfA3'),
    nfA4: rid('NfA4'),
    nfA5: rid('NfA5'),
    nfA6: rid('NfA6'),
    nfA7: rid('NfA7'),
    nfB1: rid('NfB1'),
};

const ANEXOS = {
    propostaA1: anexo('PdfPropA1', 'Proposta 105-2026.pdf'),
    propostaA2: anexo('PdfPropA2', 'Proposta 118-2026.pdf'),
    nfseA1: anexo('NfseA1', 'NFSe 0001.pdf'),
    boletoA1: anexo('BoletoA1', 'Boleto parcela 1.pdf'),
    nfseA2: anexo('NfseA2', 'NFSe 0002.pdf'),
    boletoA2: anexo('BoletoA2', 'Boleto parcela 2.pdf'),
    xmlA2: anexo('XmlA2', 'NFSe 0002.xml', 'text/xml'),
    boletoA3: anexo('BoletoA3', 'Boleto parcela 3.pdf'),
    nfseB1: anexo('NfseB1', 'NFSe empresa B.pdf'),
    boletoB1: anexo('BoletoB1', 'Boleto empresa B.pdf'),
};

function registros() {
    return {
        [S.TABELAS.CLIENTES]: [
            { id: IDS.clienteA, fields: { [S.CLIENTES.CNPJ]: '11.222.333/0001-81' } },
            { id: IDS.clienteB, fields: { [S.CLIENTES.CNPJ]: '44.555.666/0001-72' } },
        ],
        [S.TABELAS.PROPOSTA]: [
            {
                id: IDS.propA1,
                fields: {
                    [P.NUMERO]: '105-2026', [P.STATUS]: 'Aceita', [P.CLIENTE]: [IDS.clienteA],
                    [P.ARQUIVOS]: [ANEXOS.propostaA1], [P.FORMA_PAGAMENTO]: '4 parcelas',
                    [P.PRAZO_DIAS]: 30, [P.CONTRATOS]: [IDS.contA1],
                },
            },
            {
                id: IDS.propA2,
                fields: {
                    [P.NUMERO]: '118-2026', [P.STATUS]: 'Aceita', [P.CLIENTE]: [IDS.clienteA],
                    [P.ARQUIVOS]: [ANEXOS.propostaA2], [P.FORMA_PAGAMENTO]: '2 parcelas',
                    [P.PRAZO_DIAS]: 15, [P.CONTRATOS]: [IDS.contA2],
                },
            },
            {
                id: IDS.propA3,
                fields: { [P.NUMERO]: '131-2026', [P.STATUS]: 'Aceita', [P.CLIENTE]: [IDS.clienteA], [P.PRAZO_DIAS]: 30 },
            },
            {
                id: IDS.propA4,
                fields: { [P.NUMERO]: '090-2026', [P.STATUS]: 'Rejeitada', [P.CLIENTE]: [IDS.clienteA] },
            },
            {
                id: IDS.propB1,
                fields: {
                    [P.NUMERO]: '200-2026', [P.STATUS]: 'Aceita', [P.CLIENTE]: [IDS.clienteB],
                    [P.PRAZO_DIAS]: 10, [P.CONTRATOS]: [IDS.contB1],
                },
            },
        ],
        [S.TABELAS.CONTRATOS]: [
            {
                id: IDS.contA1,
                fields: {
                    [C.NOME]: 'C105-2026', [C.PROPOSTA]: [IDS.propA1], [C.STATUS]: 'Ativo', [C.PRAZO_DIAS]: [30],
                    [C.PARCELAS]: [IDS.nfA1, IDS.nfA2, IDS.nfA3, IDS.nfA4, IDS.nfA7],
                },
            },
            {
                id: IDS.contA2,
                fields: {
                    [C.NOME]: 'C118-2026', [C.PROPOSTA]: [IDS.propA2], [C.STATUS]: 'Cancelado', [C.PRAZO_DIAS]: [15],
                    [C.PARCELAS]: [IDS.nfA5, IDS.nfA6],
                },
            },
            {
                id: IDS.contB1,
                fields: { [C.NOME]: 'C200-2026', [C.PROPOSTA]: [IDS.propB1], [C.STATUS]: 'Ativo', [C.PARCELAS]: [IDS.nfB1] },
            },
        ],
        [S.TABELAS.NOTAS_FISCAIS]: [
            {
                id: IDS.nfA1,
                fields: {
                    [N.PARCELA]: 'C105-2026 - Parcela 1/4', [N.CONTRATO]: [IDS.contA1], [N.STATUS_PAGAMENTO]: 'Pago',
                    [N.VALOR_PARCELA]: 4500, [N.VALOR_PAGO]: 4500, [N.PRAZO_DIAS]: [30],
                    [N.DATA_EMISSAO_NF]: '2026-08-05', [N.VENCIMENTO]: '2026-09-04T00:00:00.000Z',
                    [N.DATA_PAGAMENTO]: '2026-09-02', [N.NFSE]: [ANEXOS.nfseA1], [N.BOLETO]: [ANEXOS.boletoA1],
                },
            },
            {
                id: IDS.nfA2,
                fields: {
                    [N.PARCELA]: 'C105-2026 - Parcela 2/4', [N.CONTRATO]: [IDS.contA1], [N.STATUS_PAGAMENTO]: 'Vencido',
                    [N.VALOR_PARCELA]: 4500, [N.VALOR_PAGO]: 1500, [N.PRAZO_DIAS]: [30],
                    [N.DATA_EMISSAO_NF]: '2026-09-05', [N.VENCIMENTO]: '2026-10-05T00:00:00.000Z',
                    [N.NFSE]: [ANEXOS.nfseA2, ANEXOS.xmlA2], [N.BOLETO]: [ANEXOS.boletoA2],
                },
            },
            {
                id: IDS.nfA3,
                fields: {
                    [N.PARCELA]: 'C105-2026 - Parcela 3/4', [N.CONTRATO]: [IDS.contA1], [N.STATUS_PAGAMENTO]: 'A Vencer',
                    [N.VALOR_PARCELA]: 4500, [N.PRAZO_DIAS]: [30],
                    [N.DATA_EMISSAO_NF]: '2026-10-05', [N.VENCIMENTO]: '2026-11-04T00:00:00.000Z',
                    [N.BOLETO]: [ANEXOS.boletoA3],
                },
            },
            {
                id: IDS.nfA4,
                fields: {
                    [N.PARCELA]: 'C105-2026 - Parcela 4/4', [N.CONTRATO]: [IDS.contA1],
                    [N.STATUS_PAGAMENTO]: 'Aguardando Emissão da NF', [N.VALOR_PARCELA]: 4500, [N.PRAZO_DIAS]: [30],
                    [N.VENCIMENTO]: { error: '#ERROR!' },
                },
            },
            {
                id: IDS.nfA5,
                fields: {
                    [N.PARCELA]: 'C118-2026 - Parcela 1/2', [N.CONTRATO]: [IDS.contA2], [N.STATUS_PAGAMENTO]: 'Pago',
                    [N.VALOR_PARCELA]: 2800, [N.VALOR_PAGO]: 2800, [N.DATA_PAGAMENTO]: '2026-07-20',
                },
            },
            {
                id: IDS.nfA6,
                fields: {
                    [N.PARCELA]: 'C118-2026 - Parcela 2/2', [N.CONTRATO]: [IDS.contA2], [N.STATUS_PAGAMENTO]: 'A Vencer',
                    [N.VALOR_PARCELA]: 2800, [N.DATA_EMISSAO_NF]: '2026-08-01', [N.VENCIMENTO]: '2026-08-16T00:00:00.000Z',
                },
            },
            {
                id: IDS.nfA7,
                fields: {
                    [N.PARCELA]: 'C105-2026 - Parcela 5/5', [N.CONTRATO]: [IDS.contA1], [N.STATUS_PAGAMENTO]: 'Cancelado',
                    [N.VALOR_PARCELA]: 900,
                },
            },
            {
                id: IDS.nfB1,
                fields: {
                    [N.PARCELA]: 'C200-2026 - Parcela 1/1', [N.CONTRATO]: [IDS.contB1], [N.STATUS_PAGAMENTO]: 'A Vencer',
                    [N.VALOR_PARCELA]: 9900, [N.NFSE]: [ANEXOS.nfseB1], [N.BOLETO]: [ANEXOS.boletoB1],
                },
            },
        ],
    };
}

function normalizarCnpj(valor) {
    const digitos = String(valor || '').replace(/\D/g, '');
    return digitos.length === 14 ? digitos : '';
}

function idsDaFormula(formula) {
    return [...String(formula || '').matchAll(/RECORD_ID\(\)='(rec[A-Za-z0-9]{14})'/g)].map(m => m[1]);
}

function copiar(valor) {
    return JSON.parse(JSON.stringify(valor));
}

// Simula finance-airtable.js: mesma interface usada por lib/financeiro.
function criarBaseFicticia() {
    const tabelas = registros();
    const chamadas = [];
    let falha = null;

    function verificarFalha() {
        if (falha) throw Object.assign(new Error('AIRTABLE_OFFLINE'), { status: 503 });
    }

    const airtable = {
        habilitado: () => true,
        async listarPropostasPorCnpj(cnpj) {
            chamadas.push({ tipo: 'propostas', cnpj });
            verificarFalha();
            const documento = normalizarCnpj(cnpj);
            const clientes = tabelas[S.TABELAS.CLIENTES].filter(r => normalizarCnpj(r.fields[S.CLIENTES.CNPJ]) === documento);
            if (clientes.length > 1) throw new Error('FINANCE_DUPLICATE_CNPJ');
            if (!clientes.length) return { cliente: null, propostas: [] };
            const cliente = { id: clientes[0].id, cnpj: documento };
            const propostas = tabelas[S.TABELAS.PROPOSTA]
                .filter(r => Array.isArray(r.fields[P.CLIENTE]) && r.fields[P.CLIENTE].length === 1 && r.fields[P.CLIENTE][0] === cliente.id)
                .map(r => ({ id: r.id, numero: r.fields[P.NUMERO] || null, status: r.fields[P.STATUS] || 'Pendente' }));
            return { cliente, propostas };
        },
        async listarRegistros(tabela, campos, formula) {
            const ids = idsDaFormula(formula);
            chamadas.push({ tipo: 'listar', tabela, campos: [...campos], ids });
            verificarFalha();
            return (tabelas[tabela] || [])
                .filter(r => ids.includes(r.id))
                .map(r => ({ id: r.id, fields: Object.fromEntries(Object.entries(r.fields).filter(([k]) => campos.includes(k))) }))
                .map(copiar);
        },
        async obterRegistro(tabela, id) {
            chamadas.push({ tipo: 'obter', tabela, id });
            verificarFalha();
            const registro = (tabelas[tabela] || []).find(r => r.id === id);
            return registro ? copiar(registro) : null;
        },
    };

    function registro(tabela, id) {
        return tabelas[tabela].find(r => r.id === id);
    }

    return {
        airtable,
        tabelas,
        chamadas,
        registro,
        falhar(ativo = true) { falha = ativo; },
        limparChamadas() { chamadas.length = 0; },
    };
}

module.exports = { criarBaseFicticia, IDS, ANEXOS, CNPJ_A, CNPJ_B, rid, aid };
