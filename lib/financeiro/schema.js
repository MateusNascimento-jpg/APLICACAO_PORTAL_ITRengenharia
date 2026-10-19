'use strict';

// Identificadores reais da base "ITR Financeiro" (appI163NTfZrDtw22), consultados
// em 17/10/2026 (handoff MAPAS/schema_financeiro_relevante.json). Centralizados
// aqui para que nenhum outro arquivo do Financeiro use nomes visíveis de campos.
// Somente leitura: este módulo nunca grava no Airtable.

const TABELAS = Object.freeze({
    CLIENTES: 'tbl8Sw1hYuEvgot8O',
    PROPOSTA: 'tblTzY3Iggkhydke2',
    CONTRATOS: 'tblxokBaJhPpLuljO',
    NOTAS_FISCAIS: 'tblWJzUP0YzY4bO5l',
});

const CLIENTES = Object.freeze({
    CNPJ: 'fldb8XcWv0Uooz3Uo',
});

const PROPOSTA = Object.freeze({
    NUMERO: 'fldrervlNmfixboQB',
    STATUS: 'fldTvIRySPUEG2Mwf',
    CLIENTE: 'fldauuqhFbHn59uOl',
    ARQUIVOS: 'fld2aWLikbuqsoOgZ', // anexo "Proposta" (PDF da proposta comercial)
    FORMA_PAGAMENTO: 'fldOO5vLkKB4b8FIS',
    PRAZO_DIAS: 'fldtZwrb2jt1zqSpz',
    CONTRATOS: 'fldd71LD7hmSr1ntG',
});

const CONTRATOS = Object.freeze({
    NOME: 'fldulgTMGqeJECXcJ', // fórmula "C" + Proposta
    PROPOSTA: 'fld1w7cU614vcJKRH',
    STATUS: 'fldyNNZMheAFjrwwl',
    PARCELAS: 'fldJtY9fg7kcVBDaQ',
    PRAZO_DIAS: 'fldnjm8pvdEE2o6kY',
});

const NOTAS_FISCAIS = Object.freeze({
    PARCELA: 'fldGsqkVGU3qJcwAg',
    CONTRATO: 'fldWCgQ24dtFRrkor',
    VALOR_PARCELA: 'fldRlfrb5nDJkEvsd',
    DATA_EMISSAO_NF: 'fldh5OUQjnlvPu60I',
    PRAZO_DIAS: 'fldQXuk6V03oynwv8',
    VENCIMENTO: 'fldCBaJQApykXXHGD',
    STATUS_PAGAMENTO: 'fldW2iU3r2NcqkO4b',
    DATA_PAGAMENTO: 'fldgfKiith4BxIWeA',
    VALOR_PAGO: 'fldYGSbXq8HGW2IVR',
    NFSE: 'fldM6vgeb35Aah0Ah',
    BOLETO: 'fldzQk31RM3uKmMou',
    // "Anexo Contrato" (fldVBdNqUGKx8S8Rb) é lookup do PDF da PROPOSTA e não é
    // lido aqui: a proposta comercial vem diretamente de Proposta.ARQUIVOS.
});

// Enumerações exatas dos campos singleSelect. Nada fora destas listas é
// classificado; valores desconhecidos ficam fora das abas.
const STATUS_PROPOSTA_ACEITA = 'Aceita';

const STATUS_CONTRATO = Object.freeze({
    ATIVO: 'Ativo',
    CONCLUIDO: 'Concluído',
    CANCELADO: 'Cancelado',
    INADIMPLENTE: 'Inadimplente',
});

const STATUS_FATURA = Object.freeze({
    AGUARDANDO_NF: 'Aguardando Emissão da NF',
    A_VENCER: 'A Vencer',
    VENCIDO: 'Vencido',
    PAGO: 'Pago',
    CANCELADO: 'Cancelado',
});

const ABAS = Object.freeze(['proximas', 'a-pagar', 'pagas', 'canceladas']);

// Tipos de documento aceitos na rota de arquivos. "contrato-formal" não existe
// de propósito: o schema atual não comprova um arquivo de contrato assinado.
const TIPOS_DOCUMENTO = Object.freeze({
    nfse: Object.freeze({ rotulo: 'NFSe', origem: 'fatura', campo: NOTAS_FISCAIS.NFSE }),
    boleto: Object.freeze({ rotulo: 'Boleto', origem: 'fatura', campo: NOTAS_FISCAIS.BOLETO }),
    proposta: Object.freeze({ rotulo: 'Proposta comercial', origem: 'contrato', campo: PROPOSTA.ARQUIVOS }),
});

// Tipos de arquivo servidos pelo Portal. Outros formatos não são listados.
const MIME_PERMITIDOS = Object.freeze({
    'application/pdf': Object.freeze({ extensao: 'pdf', exibir: true }),
    'image/png': Object.freeze({ extensao: 'png', exibir: true }),
    'image/jpeg': Object.freeze({ extensao: 'jpg', exibir: true }),
    'application/xml': Object.freeze({ extensao: 'xml', exibir: false }),
    'text/xml': Object.freeze({ extensao: 'xml', exibir: false }),
});

module.exports = {
    TABELAS,
    CLIENTES,
    PROPOSTA,
    CONTRATOS,
    NOTAS_FISCAIS,
    STATUS_PROPOSTA_ACEITA,
    STATUS_CONTRATO,
    STATUS_FATURA,
    ABAS,
    TIPOS_DOCUMENTO,
    MIME_PERMITIDOS,
};
