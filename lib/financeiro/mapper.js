'use strict';

// Funções puras do Financeiro: normalizam valores vindos do Airtable, mapeiam
// registros, consolidam a situação de cada contrato e montam o JSON enviado ao
// navegador. Não fazem I/O, por isso são testadas diretamente com fixtures
// fictícias.
//
// Granularidade pública: UM item por CONTRATO autorizado. As Notas Fiscais
// (parcelas) continuam sendo lidas e validadas aqui para consolidar a situação
// e listar NFSe/boleto, mas nunca saem do servidor como lista.

const S = require('./schema');

const RECORD_ID = /^rec[A-Za-z0-9]{14}$/;
const ATTACHMENT_ID = /^att[A-Za-z0-9]{14}$/;
const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const PRAZO_MAXIMO_DIAS = 3650;
const colecao = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

function recordIdValido(valor) {
    return typeof valor === 'string' && RECORD_ID.test(valor);
}

function anexoIdValido(valor) {
    return typeof valor === 'string' && ATTACHMENT_ID.test(valor);
}

// Links do Airtable chegam como array de Record IDs (REST) ou de objetos { id }
// (conectores/fixtures). Qualquer item malformado invalida o vínculo inteiro:
// melhor negar do que autorizar com base em metade de uma lista.
function linksValidos(valor) {
    if (valor == null) return [];
    if (!Array.isArray(valor)) return null;
    const ids = [];
    for (const item of valor) {
        const id = typeof item === 'string' ? item : item && typeof item === 'object' ? item.id : null;
        if (!recordIdValido(id)) return null;
        if (!ids.includes(id)) ids.push(id);
    }
    return ids;
}

// Lookups e rollups podem chegar como arrays. Um array só é aceito quando todos
// os itens são iguais; valores divergentes resultam em `undefined` (ambíguo).
function valorUnico(valor) {
    if (!Array.isArray(valor)) return valor;
    if (!valor.length) return null;
    const primeiro = valor[0];
    return valor.every(item => item === primeiro) ? primeiro : undefined;
}

function texto(valor, maximo = 200) {
    let bruto = valorUnico(valor);
    if (bruto && typeof bruto === 'object' && typeof bruto.name === 'string') bruto = bruto.name;
    if (typeof bruto === 'number' && Number.isFinite(bruto)) bruto = String(bruto);
    if (typeof bruto !== 'string') return null;
    const limpo = bruto.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return limpo ? limpo.slice(0, maximo) : null;
}

function valorEnum(valor, permitidos) {
    const t = texto(valor, 80);
    return t && permitidos.includes(t) ? t : null;
}

// Valores monetários: somente números finitos e não negativos, em centavos.
// Fórmulas com erro chegam como objetos ({ error } / { specialValue }) e viram null.
function moeda(valor) {
    const numero = valorUnico(valor);
    if (typeof numero !== 'number' || !Number.isFinite(numero) || numero < 0) return null;
    return Math.round(numero * 100) / 100;
}

function dias(valor) {
    const numero = valorUnico(valor);
    if (!Number.isInteger(numero) || numero < 0 || numero > PRAZO_MAXIMO_DIAS) return null;
    return numero;
}

// Datas são tratadas como datas de calendário (AAAA-MM-DD). Fórmulas do Airtable
// devolvem ISO em UTC à meia-noite; usar só a parte da data evita que o fuso de
// Brasília mova o vencimento para o dia anterior.
function dataIso(valor) {
    const bruto = valorUnico(valor);
    if (typeof bruto !== 'string') return null;
    const partes = DATA_ISO.exec(bruto.trim());
    if (!partes) return null;
    const [ano, mes, dia] = partes.slice(1, 4).map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return null;
    return `${partes[1]}-${partes[2]}-${partes[3]}`;
}

function mimeNormalizado(valor) {
    return String(valor || '').split(';')[0].trim().toLowerCase();
}

function nomeArquivo(valor, rotuloPadrao, extensao) {
    const limpo = String(valor || '')
        .replace(/[\u0000-\u001f\u007f]+/g, '')
        .replace(/[\\/]+/g, '_')
        .trim()
        .slice(0, 160);
    return limpo || `${rotuloPadrao}.${extensao}`;
}

// Anexos válidos: ID att..., URL presente, tipo de arquivo permitido e sem
// duplicidade. A URL fica apenas no servidor; o navegador nunca a recebe.
function anexosSeguros(valor, rotuloPadrao) {
    if (!Array.isArray(valor)) return [];
    const vistos = new Set();
    const anexos = [];
    for (const item of valor) {
        if (!item || typeof item !== 'object') continue;
        if (!anexoIdValido(item.id) || vistos.has(item.id)) continue;
        if (typeof item.url !== 'string' || !item.url) continue;
        const mime = mimeNormalizado(item.type);
        const regra = S.MIME_PERMITIDOS[mime];
        if (!regra) continue;
        vistos.add(item.id);
        anexos.push({
            id: item.id,
            nome: nomeArquivo(item.filename, rotuloPadrao, regra.extensao),
            mime,
            tamanho: Number.isSafeInteger(item.size) && item.size >= 0 ? item.size : null,
            url: item.url,
        });
    }
    return anexos;
}

function mapearProposta(registro) {
    const f = registro.fields || {};
    const P = S.PROPOSTA;
    return {
        id: registro.id,
        numero: texto(f[P.NUMERO], 60),
        status: texto(f[P.STATUS], 60),
        clienteIds: linksValidos(f[P.CLIENTE]),
        contratoIds: linksValidos(f[P.CONTRATOS]),
        formaPagamento: texto(f[P.FORMA_PAGAMENTO], 120),
        prazoPagamentoDias: dias(f[P.PRAZO_DIAS]),
        valor: moeda(f[P.VALOR]),
        anexos: anexosSeguros(f[P.ARQUIVOS], S.TIPOS_DOCUMENTO.proposta.rotulo),
    };
}

function mapearContrato(registro) {
    const f = registro.fields || {};
    const C = S.CONTRATOS;
    return {
        id: registro.id,
        nome: texto(f[C.NOME], 80),
        status: valorEnum(f[C.STATUS], Object.values(S.STATUS_CONTRATO)),
        propostaIds: linksValidos(f[C.PROPOSTA]),
        parcelaIds: linksValidos(f[C.PARCELAS]),
        prazoPagamentoDias: dias(f[C.PRAZO_DIAS]),
    };
}

function mapearFatura(registro) {
    const f = registro.fields || {};
    const N = S.NOTAS_FISCAIS;
    return {
        id: registro.id,
        parcela: texto(f[N.PARCELA], 160),
        contratoIds: linksValidos(f[N.CONTRATO]),
        status: valorEnum(f[N.STATUS_PAGAMENTO], Object.values(S.STATUS_FATURA)),
        valorParcela: moeda(f[N.VALOR_PARCELA]),
        valorPago: moeda(f[N.VALOR_PAGO]),
        dataEmissaoNf: dataIso(f[N.DATA_EMISSAO_NF]),
        prazoPagamentoDias: dias(f[N.PRAZO_DIAS]),
        vencimento: dataIso(f[N.VENCIMENTO]),
        dataPagamento: dataIso(f[N.DATA_PAGAMENTO]),
        nfse: anexosSeguros(f[N.NFSE], S.TIPOS_DOCUMENTO.nfse.rotulo),
        boleto: anexosSeguros(f[N.BOLETO], S.TIPOS_DOCUMENTO.boleto.rotulo),
    };
}

const SIT = S.SITUACAO_CONTRATO;
const ABERTAS = new Set([S.STATUS_FATURA.A_VENCER, S.STATUS_FATURA.VENCIDO]);

// Situação financeira consolidada de UM contrato (coluna "Situação").
//
// Fontes separadas: `Contratos.Status do Contrato` é o estado contratual
// (Ativo/Concluído/Cancelado/Inadimplente, exibido em Detalhes); a situação
// abaixo deriva de `Notas Fiscais.Status do Pagamento` e só usa o contrato
// para o cancelamento. Ordem de decisão:
//   1. contrato Cancelado                    -> Cancelado (revisao se houver cobrança A Vencer/Vencido);
//   2. parcela fora do enum, vínculo de parcela recusado ou lista de parcelas
//      malformada                            -> Em conferência (não há base segura);
//   3. sem parcelas: contrato Ativo/sem status -> Em preparação;
//                    Concluído/Inadimplente    -> Em conferência;
//   4. parcelas aplicáveis = todas exceto Canceladas; nenhuma aplicável -> Em conferência;
//   5. alguma Vencida -> Vencido; senão alguma A Vencer -> A Vencer;
//      senão alguma Aguardando Emissão da NF -> Aguardando Emissão da NF;
//   6. todas as aplicáveis Pagas -> Pago.
// "Pago" exige TODAS as parcelas aplicáveis pagas: uma parcela paga nunca
// torna o contrato pago.
function situacaoContrato(contrato, faturas, { parcelasRecusadas = 0 } = {}) {
    const abertas = faturas.some(f => ABERTAS.has(f.status));
    if (contrato.status === S.STATUS_CONTRATO.CANCELADO) return { situacao: SIT.CANCELADO, revisao: abertas };
    const conferencia = { situacao: SIT.EM_CONFERENCIA, revisao: false };
    if (contrato.parcelasInvalidas || parcelasRecusadas > 0 || faturas.some(f => f.status === null)) return conferencia;
    if (!faturas.length) {
        const preparacao = contrato.status === S.STATUS_CONTRATO.ATIVO || contrato.status === null;
        return preparacao ? { situacao: SIT.EM_PREPARACAO, revisao: false } : conferencia;
    }
    const aplicaveis = faturas.filter(f => f.status !== S.STATUS_FATURA.CANCELADO).map(f => f.status);
    if (!aplicaveis.length) return conferencia;
    for (const status of [S.STATUS_FATURA.VENCIDO, S.STATUS_FATURA.A_VENCER, S.STATUS_FATURA.AGUARDANDO_NF]) {
        if (aplicaveis.includes(status)) return { situacao: status, revisao: false };
    }
    return { situacao: SIT.PAGO, revisao: false };
}

function primeiroDefinido(...valores) {
    return valores.find(valor => valor != null) ?? null;
}

function documentoPublico(tipo, registroId, anexo) {
    return {
        tipo,
        rotulo: S.TIPOS_DOCUMENTO[tipo].rotulo,
        registroId,
        anexoId: anexo.id,
        nome: anexo.nome,
        mime: anexo.mime,
        tamanho: anexo.tamanho,
        visualizavel: S.MIME_PERMITIDOS[anexo.mime].exibir,
    };
}

function comparar(a, b) {
    return colecao.compare(a || '', b || '');
}

// Datas AAAA-MM-DD ordenam corretamente por comparação simples de texto.
function compararNulosPorUltimo(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return a === b ? 0 : (a < b ? -1 : 1);
}

// Documentos fiscais do contrato, sem identificar parcelas: NFSe e boleto de
// cada nota com status oficial (exceto Cancelada), em ordem cronológica.
function documentosFiscais(faturas) {
    return faturas
        .filter(f => f.status !== null && f.status !== S.STATUS_FATURA.CANCELADO)
        .sort((a, b) => compararNulosPorUltimo(a.dataEmissaoNf, b.dataEmissaoNf)
            || compararNulosPorUltimo(a.vencimento, b.vencimento)
            || comparar(a.parcela, b.parcela))
        .flatMap(f => [
            ...f.nfse.map(anexo => documentoPublico('nfse', f.id, anexo)),
            ...f.boleto.map(anexo => documentoPublico('boleto', f.id, anexo)),
        ]);
}

// Estado geral da área, em ordem de prioridade:
//   disponivel    — há ao menos um contrato para listar;
//   conferencia   — registros recebidos, mas recusados por vínculo inválido
//                   (nunca mascarados como "processamento");
//   processamento — proposta aceita ainda sem contrato cadastrado pela equipe;
//   vazio         — nada aplicável (situação não esperada; mensagem neutra).
function definirEstado({ visiveis, itensEmConferencia, emPreparacao }) {
    if (visiveis > 0) return 'disponivel';
    if (itensEmConferencia > 0) return 'conferencia';
    if (emPreparacao > 0) return 'processamento';
    return 'vazio';
}

// Itens que existem no Airtable mas não podem ser consolidados com segurança.
// Devolve só Record IDs para log no servidor.
function diagnosticarPainel({ contratos, faturas }) {
    const contratoPorId = new Map(contratos.map(c => [c.id, c]));
    const parcelasNaoClassificadas = faturas
        .filter(f => contratoPorId.has(f.contratoIds?.[0]) && f.status === null)
        .map(f => f.id);
    const contratosSemParcelas = contratos
        .filter(c => c.parcelaIds.length === 0 && !c.parcelasInvalidas
            && (c.status === S.STATUS_CONTRATO.CONCLUIDO || c.status === S.STATUS_CONTRATO.INADIMPLENTE))
        .map(c => c.id);
    return { parcelasNaoClassificadas, contratosSemParcelas };
}

// Monta o JSON do navegador somente com campos tipados: um item por contrato.
// URLs do Airtable, IDs de clientes, identificação, valores e datas de
// parcelas nunca entram aqui. `inconsistencias` = propostas/contratos
// recusados pelo serviço por vínculo inválido (não aparecem na lista).
function montarPainel({ propostas, contratos, faturas, inconsistencias = 0, atualizadoEm }) {
    const propostaPorId = new Map(propostas.map(p => [p.id, p]));
    const faturasPorContrato = new Map(contratos.map(c => [c.id, []]));
    for (const fatura of faturas) {
        // O serviço já validou os vínculos; esta checagem só impede exceções.
        faturasPorContrato.get(fatura.contratoIds?.[0])?.push(fatura);
    }

    const contratosValidos = contratos.filter(contrato => propostaPorId.has(contrato.propostaIds?.[0]));
    const contratosPublicos = contratosValidos
        .map(contrato => {
            const proposta = propostaPorId.get(contrato.propostaIds[0]);
            const doContrato = faturasPorContrato.get(contrato.id);
            const validadas = new Set(doContrato.map(f => f.id));
            const parcelasRecusadas = contrato.parcelaIds.filter(id => !validadas.has(id)).length;
            const { situacao, revisao } = situacaoContrato(contrato, doContrato, { parcelasRecusadas });
            return {
                id: contrato.id,
                nome: contrato.nome,
                status: contrato.status,
                situacao,
                revisao,
                proposta: { id: proposta.id, numero: proposta.numero, formaPagamento: proposta.formaPagamento },
                valorTotal: proposta.valor,
                prazoPagamentoDias: primeiroDefinido(contrato.prazoPagamentoDias, proposta.prazoPagamentoDias),
                documentos: [
                    ...proposta.anexos.map(anexo => documentoPublico('proposta', contrato.id, anexo)),
                    ...documentosFiscais(doContrato),
                ],
            };
        })
        .sort((a, b) => comparar(a.nome, b.nome) || comparar(a.proposta.numero, b.proposta.numero));

    // Proposta aceita sem nenhum contrato vinculado = preparação (o contrato é
    // criado manualmente pela equipe comercial). Proposta cujo vínculo existe
    // mas foi recusado conta como inconsistência (vem em `inconsistencias`).
    const propostasEmPreparacao = propostas
        .filter(p => p.contratoIds.length === 0 && !p.vinculoContratoInvalido)
        .map(p => ({ numero: p.numero }))
        .sort((a, b) => comparar(a.numero, b.numero));
    const estado = definirEstado({
        visiveis: contratosPublicos.length,
        itensEmConferencia: inconsistencias,
        emPreparacao: propostasEmPreparacao.length,
    });

    return {
        estado,
        emProcessamento: estado === 'processamento',
        atualizadoEm,
        contratos: contratosPublicos,
        pendencias: { propostasEmPreparacao, itensEmConferencia: inconsistencias },
    };
}

module.exports = {
    recordIdValido,
    anexoIdValido,
    linksValidos,
    valorUnico,
    texto,
    moeda,
    dias,
    dataIso,
    anexosSeguros,
    mapearProposta,
    mapearContrato,
    mapearFatura,
    situacaoContrato,
    documentosFiscais,
    diagnosticarPainel,
    definirEstado,
    montarPainel,
};
