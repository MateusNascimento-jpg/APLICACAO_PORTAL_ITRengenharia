'use strict';

// Consultas do Financeiro (somente leitura) na base "ITR Financeiro".
//
// Cadeia de autorização, sempre por Record IDs e nunca por nome/e-mail/lookup:
//   CNPJ da sessão → Clientes (registro único) → Proposta "Aceita" ligada só a
//   esse cliente → Contratos com exatamente essa proposta → Notas Fiscais cujo
//   vínculo aponta de volta para o mesmo contrato.
// Qualquer quebra da cadeia remove o registro da resposta (falha fechada).
//
// Sem cache de dados financeiros: cada GET (lista ou documento) relê no
// Airtable cliente, propostas, contratos e faturas. Os caches curtos de
// finance-airtable.js (lista de clientes 60 s, lista de propostas 30 s) são
// usados apenas para DESCOBRIR candidatos; nenhum item é autorizado por eles.

const S = require('./schema');
const M = require('./mapper');
const { normalizarCnpj } = require('../client-scope');

const IDS_POR_CONSULTA = 40;
const LIMITE_CONTRATOS = 200;
const LIMITE_FATURAS = 1000;

const CAMPOS_PROPOSTA = [
    S.PROPOSTA.NUMERO, S.PROPOSTA.STATUS, S.PROPOSTA.CLIENTE, S.PROPOSTA.ARQUIVOS,
    S.PROPOSTA.FORMA_PAGAMENTO, S.PROPOSTA.PRAZO_DIAS, S.PROPOSTA.CONTRATOS,
];
const CAMPOS_CONTRATO = [
    S.CONTRATOS.NOME, S.CONTRATOS.PROPOSTA, S.CONTRATOS.STATUS, S.CONTRATOS.PARCELAS, S.CONTRATOS.PRAZO_DIAS,
];
const CAMPOS_FATURA = [
    S.NOTAS_FISCAIS.PARCELA, S.NOTAS_FISCAIS.CONTRATO, S.NOTAS_FISCAIS.VALOR_PARCELA,
    S.NOTAS_FISCAIS.DATA_EMISSAO_NF, S.NOTAS_FISCAIS.PRAZO_DIAS, S.NOTAS_FISCAIS.VENCIMENTO,
    S.NOTAS_FISCAIS.STATUS_PAGAMENTO, S.NOTAS_FISCAIS.DATA_PAGAMENTO, S.NOTAS_FISCAIS.VALOR_PAGO,
    S.NOTAS_FISCAIS.NFSE, S.NOTAS_FISCAIS.BOLETO,
];

function erroComCodigo(codigo) {
    const erro = new Error(codigo);
    erro.code = codigo;
    return erro;
}

// Os IDs já passaram por recordIdValido (rec + 14 alfanuméricos), então a
// fórmula não tem como receber aspas ou outro conteúdo controlado pelo usuário.
function formulaPorIds(ids) {
    return `OR(${ids.map(id => `RECORD_ID()='${id}'`).join(',')})`;
}

function semRegistro() {}

// Registro por pedido: repassa o código ao log e conta os itens descartados
// por inconsistência, para o painel não confundir "em conferência" com
// "em processamento".
function criarOcorrencias(registrar) {
    const ocorrencias = {
        inconsistencias: 0,
        anotar(codigo, registroId) {
            ocorrencias.inconsistencias += 1;
            registrar(codigo, registroId);
        },
    };
    return ocorrencias;
}

function createFinanceiroService({ airtable, agora = () => Date.now() }) {
    async function buscarPorIds(tabela, campos, ids, ocorrencias, codigoAusente) {
        const unicos = [...new Set(ids)].filter(M.recordIdValido);
        const registros = [];
        for (let i = 0; i < unicos.length; i += IDS_POR_CONSULTA) {
            const lote = unicos.slice(i, i + IDS_POR_CONSULTA);
            registros.push(...await airtable.listarRegistros(tabela, campos, formulaPorIds(lote)));
        }
        const pedidos = new Set(unicos);
        const recebidos = registros.filter(registro => registro && pedidos.has(registro.id));
        if (ocorrencias && codigoAusente) {
            const encontrados = new Set(recebidos.map(r => r.id));
            unicos.filter(id => !encontrados.has(id)).forEach(id => ocorrencias.anotar(codigoAusente, id));
        }
        return recebidos;
    }

    // Etapa 1: cliente único pelo CNPJ e propostas "Aceita" revalidadas agora.
    async function resolverPropostasAutorizadas(documento, ocorrencias) {
        const registrar = ocorrencias.anotar;
        let resultado;
        try {
            resultado = await airtable.listarPropostasPorCnpj(documento);
        } catch (error) {
            if (error.message === 'FINANCE_DUPLICATE_CNPJ') {
                registrar('FIN_CLIENTE_DUPLICADO');
                return null;
            }
            throw error;
        }
        const cliente = resultado?.cliente;
        if (!cliente || !M.recordIdValido(cliente.id)) return null;
        const candidatas = (resultado.propostas || [])
            .filter(p => p && p.status === S.STATUS_PROPOSTA_ACEITA && M.recordIdValido(p.id))
            .map(p => p.id);
        if (!candidatas.length) return null;

        // A lista de propostas do Portal tem cache curto; para dados financeiros
        // o vínculo e o status são conferidos de novo direto no Airtable.
        const [registroCliente, registrosPropostas] = await Promise.all([
            airtable.obterRegistro(S.TABELAS.CLIENTES, cliente.id),
            buscarPorIds(S.TABELAS.PROPOSTA, CAMPOS_PROPOSTA, candidatas),
        ]);
        if (registroCliente?.id !== cliente.id || normalizarCnpj(registroCliente.fields?.[S.CLIENTES.CNPJ]) !== documento) {
            registrar('FIN_CLIENTE_DIVERGENTE');
            return null;
        }

        const propostas = [];
        for (const proposta of registrosPropostas.map(M.mapearProposta)) {
            const vinculoUnico = proposta.clienteIds?.length === 1 && proposta.clienteIds[0] === cliente.id;
            if (proposta.status !== S.STATUS_PROPOSTA_ACEITA || !vinculoUnico) continue;
            if (proposta.contratoIds === null) {
                registrar('FIN_PROPOSTA_VINCULO_CONTRATO_INVALIDO', proposta.id);
                proposta.contratoIds = [];
                proposta.vinculoContratoInvalido = true;
            }
            propostas.push(proposta);
        }
        return propostas.length ? propostas : null;
    }

    // Etapa 2: contratos alcançados pelas propostas e que apontam somente para
    // uma delas. Contrato com várias propostas fica bloqueado até revisão.
    async function carregarContratos(propostas, ocorrencias) {
        const registrar = ocorrencias.anotar;
        const propostasAutorizadas = new Set(propostas.map(p => p.id));
        const ids = [...new Set(propostas.flatMap(p => p.contratoIds))];
        if (ids.length > LIMITE_CONTRATOS) throw erroComCodigo('FINANCE_LIMIT');

        const registros = await buscarPorIds(S.TABELAS.CONTRATOS, CAMPOS_CONTRATO, ids, ocorrencias, 'FIN_CONTRATO_AUSENTE');
        const contratos = [];
        for (const contrato of registros.map(M.mapearContrato)) {
            if (!contrato.propostaIds || contrato.propostaIds.length !== 1) {
                registrar('FIN_CONTRATO_VINCULO_AMBIGUO', contrato.id);
                continue;
            }
            if (!propostasAutorizadas.has(contrato.propostaIds[0])) {
                registrar('FIN_CONTRATO_PROPOSTA_NAO_AUTORIZADA', contrato.id);
                continue;
            }
            if (contrato.parcelaIds === null) {
                registrar('FIN_CONTRATO_PARCELAS_INVALIDAS', contrato.id);
                contrato.parcelaIds = [];
            }
            contratos.push(contrato);
        }
        return contratos;
    }

    // Uma fatura só é aceita quando o contrato a lista em "Parcelas" E o campo
    // "Contrato" da fatura aponta exatamente para esse mesmo contrato.
    function mapaFaturaContrato(contratos) {
        const mapa = new Map();
        for (const contrato of contratos) {
            for (const faturaId of contrato.parcelaIds) {
                mapa.set(faturaId, mapa.has(faturaId) && mapa.get(faturaId) !== contrato.id ? null : contrato.id);
            }
        }
        return mapa;
    }

    function vinculoFaturaValido(fatura, contratoEsperado) {
        return Boolean(contratoEsperado)
            && fatura.contratoIds?.length === 1
            && fatura.contratoIds[0] === contratoEsperado;
    }

    async function carregarFaturas(contratos, ocorrencias) {
        const registrar = ocorrencias.anotar;
        const contratoPorFatura = mapaFaturaContrato(contratos);
        if (contratoPorFatura.size > LIMITE_FATURAS) throw erroComCodigo('FINANCE_LIMIT');
        const registros = await buscarPorIds(S.TABELAS.NOTAS_FISCAIS, CAMPOS_FATURA, [...contratoPorFatura.keys()], ocorrencias, 'FIN_FATURA_AUSENTE');
        const faturas = [];
        for (const fatura of registros.map(M.mapearFatura)) {
            if (!vinculoFaturaValido(fatura, contratoPorFatura.get(fatura.id))) {
                registrar('FIN_FATURA_VINCULO_INCONSISTENTE', fatura.id);
                continue;
            }
            faturas.push(fatura);
        }
        return faturas;
    }

    // Painel: sempre consultado agora, sem reaproveitar resultado anterior.
    async function carregarPainel(cnpj, { registrar = semRegistro } = {}) {
        const documento = normalizarCnpj(cnpj);
        if (!documento) return null;
        const ocorrencias = criarOcorrencias(registrar);
        const propostas = await resolverPropostasAutorizadas(documento, ocorrencias);
        if (!propostas) return null;
        const contratos = await carregarContratos(propostas, ocorrencias);
        const faturas = await carregarFaturas(contratos, ocorrencias);

        // Diagnóstico seguro: só código + Record ID no log do servidor.
        const diagnostico = M.diagnosticarPainel({ contratos, faturas });
        diagnostico.parcelasNaoClassificadas.forEach(id => registrar('FIN_PARCELA_NAO_CLASSIFICADA', id));
        diagnostico.contratosSemParcelas.forEach(id => registrar('FIN_CONTRATO_SEM_PARCELAS_INCONSISTENTE', id));

        return M.montarPainel({
            propostas,
            contratos,
            faturas,
            inconsistencias: ocorrencias.inconsistencias,
            atualizadoEm: new Date(agora()).toISOString(),
        });
    }

    // Documentos: a cadeia inteira é revalidada a cada pedido (sem cache do
    // painel), e o registro da fatura só é lido depois de confirmado que ele
    // pertence a um contrato autorizado deste CNPJ.
    async function localizarDocumento(cnpj, tipo, registroId, anexoId, registrar = semRegistro) {
        const definicao = Object.hasOwn(S.TIPOS_DOCUMENTO, tipo) ? S.TIPOS_DOCUMENTO[tipo] : null;
        const documento = normalizarCnpj(cnpj);
        if (!definicao || !documento || !M.recordIdValido(registroId) || !M.anexoIdValido(anexoId)) return null;

        const ocorrencias = criarOcorrencias(registrar);
        const propostas = await resolverPropostasAutorizadas(documento, ocorrencias);
        if (!propostas) return null;
        const contratos = await carregarContratos(propostas, ocorrencias);

        if (definicao.origem === 'contrato') {
            const contrato = contratos.find(c => c.id === registroId);
            const proposta = contrato && propostas.find(p => p.id === contrato.propostaIds[0]);
            const anexo = proposta?.anexos.find(a => a.id === anexoId);
            return anexo ? { ...anexo, alvo: 'Contrato' } : null;
        }

        const contratoEsperado = mapaFaturaContrato(contratos).get(registroId);
        if (!contratoEsperado) return null;
        const registro = await airtable.obterRegistro(S.TABELAS.NOTAS_FISCAIS, registroId);
        if (!registro || registro.id !== registroId) return null;
        const fatura = M.mapearFatura(registro);
        if (!vinculoFaturaValido(fatura, contratoEsperado)) {
            registrar('FIN_FATURA_VINCULO_INCONSISTENTE', registroId);
            return null;
        }
        const anexo = fatura[tipo].find(a => a.id === anexoId);
        return anexo ? { ...anexo, alvo: 'NotaFiscal' } : null;
    }

    return { carregarPainel, localizarDocumento };
}

module.exports = { createFinanceiroService, formulaPorIds };
