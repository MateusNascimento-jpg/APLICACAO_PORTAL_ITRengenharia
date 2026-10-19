'use strict';

// Funções puras do Financeiro: normalizam valores vindos do Airtable, mapeiam
// registros, classificam faturas nas abas e montam o JSON enviado ao navegador.
// Não fazem I/O, por isso são testadas diretamente com fixtures fictícias.

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

// Regra aprovada (handoff 02): a aba vem do Status do Pagamento da fatura; o
// status do contrato só exclui cobranças de contrato cancelado e restringe
// "Próximas" a contratos ativos. Status oficiais nunca são reescritos.
function classificarFatura(statusFatura, statusContrato) {
    const F = S.STATUS_FATURA;
    const contratoCancelado = statusContrato === S.STATUS_CONTRATO.CANCELADO;
    switch (statusFatura) {
        case F.PAGO:
            return { aba: 'pagas', revisao: false };
        case F.CANCELADO:
            return { aba: 'canceladas', revisao: false };
        case F.A_VENCER:
        case F.VENCIDO:
            return contratoCancelado ? { aba: 'canceladas', revisao: true } : { aba: 'a-pagar', revisao: false };
        case F.AGUARDANDO_NF:
            if (contratoCancelado) return { aba: 'canceladas', revisao: false };
            if (statusContrato === S.STATUS_CONTRATO.ATIVO) return { aba: 'proximas', revisao: false };
            return { aba: null, revisao: false };
        default:
            return { aba: null, revisao: false };
    }
}

// Diferença informativa entre parcela e valor pago. Só existe quando os dois
// valores são confiáveis e houve pagamento parcial; nunca altera a situação.
function diferencaCalculada(valorParcela, valorPago) {
    if (valorParcela == null || valorPago == null) return null;
    if (valorPago <= 0 || valorPago >= valorParcela) return null;
    return Math.round((valorParcela - valorPago) * 100) / 100;
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
function compararNulosPorUltimo(a, b, ordem) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (a === b) return 0;
    const crescente = a < b ? -1 : 1;
    return ordem === 'desc' ? -crescente : crescente;
}

const ORDEM_ABAS = Object.fromEntries(S.ABAS.map((aba, indice) => [aba, indice]));

function compararFaturas(a, b) {
    if (a.aba !== b.aba) return ORDEM_ABAS[a.aba] - ORDEM_ABAS[b.aba];
    const porContrato = comparar(a.contratoNome, b.contratoNome) || comparar(a.parcela, b.parcela);
    if (a.aba === 'proximas') {
        const prazoA = a.prazoPagamentoDias == null ? 1 : 0;
        const prazoB = b.prazoPagamentoDias == null ? 1 : 0;
        return prazoA - prazoB || porContrato;
    }
    if (a.aba === 'a-pagar') {
        const vencidoA = a.status === S.STATUS_FATURA.VENCIDO ? 0 : 1;
        const vencidoB = b.status === S.STATUS_FATURA.VENCIDO ? 0 : 1;
        return vencidoA - vencidoB || compararNulosPorUltimo(a.vencimento, b.vencimento, 'asc') || porContrato;
    }
    if (a.aba === 'pagas') return compararNulosPorUltimo(a.dataPagamento, b.dataPagamento, 'desc') || porContrato;
    return porContrato;
}

// Contrato sem nenhuma parcela: "Ativo" (ou sem status) ainda está em
// preparação pela automação; "Concluído"/"Inadimplente" sem parcelas é dado
// inconsistente e vai para conferência. Cancelado aparece como histórico.
function contratoEmPreparacao(contrato) {
    return contrato.parcelaIds.length === 0
        && (contrato.status === S.STATUS_CONTRATO.ATIVO || contrato.status === null);
}

function contratoSemParcelasInconsistente(contrato) {
    return contrato.parcelaIds.length === 0
        && (contrato.status === S.STATUS_CONTRATO.CONCLUIDO || contrato.status === S.STATUS_CONTRATO.INADIMPLENTE);
}

// Itens que existem no Airtable, mas não podem ser exibidos com segurança.
// Devolve só Record IDs para log no servidor; o navegador recebe apenas a contagem.
function diagnosticarPainel({ contratos, faturas }) {
    const contratoPorId = new Map(contratos.map(c => [c.id, c]));
    const parcelasNaoClassificadas = faturas
        .filter(f => {
            const contrato = contratoPorId.get(f.contratoIds?.[0]);
            return contrato && !classificarFatura(f.status, contrato.status).aba;
        })
        .map(f => f.id);
    const contratosSemParcelas = contratos.filter(contratoSemParcelasInconsistente).map(c => c.id);
    return { parcelasNaoClassificadas, contratosSemParcelas };
}

// Estado geral da área, em ordem de prioridade:
//   disponivel   — há ao menos uma linha para mostrar nas abas;
//   conferencia  — há registros recebidos, mas inconsistentes ou não classificáveis
//                  (nunca mascarados como "processamento");
//   processamento — proposta aceita sem contrato ou contrato ativo sem parcelas;
//   vazio        — nada aplicável (situação não esperada; mensagem neutra).
function definirEstado({ visiveis, itensEmConferencia, emPreparacao }) {
    if (visiveis > 0) return 'disponivel';
    if (itensEmConferencia > 0) return 'conferencia';
    if (emPreparacao > 0) return 'processamento';
    return 'vazio';
}

// Monta o JSON do navegador somente com campos tipados. URLs do Airtable,
// IDs de clientes, totais internos e dados de outras tabelas nunca entram aqui.
// `inconsistencias` = registros descartados pelo serviço por vínculo inválido.
function montarPainel({ propostas, contratos, faturas, inconsistencias = 0, atualizadoEm }) {
    const propostaPorId = new Map(propostas.map(p => [p.id, p]));
    const contratoPorId = new Map(contratos.map(c => [c.id, c]));
    const faturasPorContrato = new Map(contratos.map(c => [c.id, 0]));

    const faturasPublicas = [];
    for (const fatura of faturas) {
        // O serviço já validou os vínculos; esta checagem só impede exceções.
        const contrato = contratoPorId.get(fatura.contratoIds?.[0]);
        const proposta = contrato && propostaPorId.get(contrato.propostaIds?.[0]);
        if (!contrato || !proposta) continue;
        const { aba, revisao } = classificarFatura(fatura.status, contrato.status);
        if (!aba) continue;
        faturasPorContrato.set(contrato.id, faturasPorContrato.get(contrato.id) + 1);
        faturasPublicas.push({
            id: fatura.id,
            contratoId: contrato.id,
            contratoNome: contrato.nome,
            parcela: fatura.parcela,
            aba,
            revisao,
            status: fatura.status,
            valorParcela: fatura.valorParcela,
            valorPago: fatura.valorPago,
            diferenca: diferencaCalculada(fatura.valorParcela, fatura.valorPago),
            prazoPagamentoDias: primeiroDefinido(fatura.prazoPagamentoDias, contrato.prazoPagamentoDias, proposta.prazoPagamentoDias),
            dataEmissaoNf: fatura.dataEmissaoNf,
            vencimento: fatura.vencimento,
            dataPagamento: fatura.dataPagamento,
            documentos: [
                ...fatura.nfse.map(anexo => documentoPublico('nfse', fatura.id, anexo)),
                ...fatura.boleto.map(anexo => documentoPublico('boleto', fatura.id, anexo)),
            ],
        });
    }
    faturasPublicas.sort(compararFaturas);

    const contratosValidos = contratos.filter(contrato => propostaPorId.has(contrato.propostaIds?.[0]));
    const contratosPublicos = contratosValidos
        .map(contrato => {
            const proposta = propostaPorId.get(contrato.propostaIds[0]);
            return {
                id: contrato.id,
                nome: contrato.nome,
                status: contrato.status,
                proposta: { id: proposta.id, numero: proposta.numero, formaPagamento: proposta.formaPagamento },
                prazoPagamentoDias: primeiroDefinido(contrato.prazoPagamentoDias, proposta.prazoPagamentoDias),
                quantidadeFaturas: faturasPorContrato.get(contrato.id),
                documentos: proposta.anexos.map(anexo => documentoPublico('proposta', contrato.id, anexo)),
            };
        })
        .sort((a, b) => comparar(a.nome, b.nome));

    // Proposta sem nenhum contrato vinculado = preparação. Proposta cujo vínculo
    // existe mas foi recusado conta como inconsistência (vem em `inconsistencias`).
    const propostasEmPreparacao = propostas
        .filter(p => p.contratoIds.length === 0 && !p.vinculoContratoInvalido)
        .map(p => ({ numero: p.numero }))
        .sort((a, b) => comparar(a.numero, b.numero));
    const contratosEmPreparacao = contratosValidos
        .filter(contratoEmPreparacao)
        .map(c => ({ nome: c.nome }))
        .sort((a, b) => comparar(a.nome, b.nome));
    const diagnostico = diagnosticarPainel({ contratos: contratosValidos, faturas });
    const itensEmConferencia = inconsistencias
        + diagnostico.parcelasNaoClassificadas.length
        + diagnostico.contratosSemParcelas.length;
    const contratosCancelados = contratosPublicos.filter(c => c.status === S.STATUS_CONTRATO.CANCELADO).length;
    const estado = definirEstado({
        visiveis: faturasPublicas.length + contratosCancelados,
        itensEmConferencia,
        emPreparacao: propostasEmPreparacao.length + contratosEmPreparacao.length,
    });

    return {
        estado,
        emProcessamento: estado === 'processamento',
        atualizadoEm,
        contratos: contratosPublicos,
        faturas: faturasPublicas,
        pendencias: { propostasEmPreparacao, contratosEmPreparacao, itensEmConferencia },
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
    classificarFatura,
    diferencaCalculada,
    compararFaturas,
    diagnosticarPainel,
    definirEstado,
    montarPainel,
};
