'use strict';

// Leitura segura de anexos do Airtable para o Financeiro. O navegador nunca
// recebe a URL de origem: o servidor baixa o arquivo depois da autorização,
// confere destino, tamanho, tipo declarado e assinatura binária, e só então
// devolve os bytes com cabeçalhos próprios.
//
// Memória: o arquivo precisa ser lido inteiro para validar a assinatura antes
// de responder. Por isso há (1) limite de downloads simultâneos por conta e no
// servidor e (2) orçamento global de bytes em memória; quem excede recebe
// "tente novamente em instantes" em vez de pressionar a memória do VPS.

const { allowedUrl } = require('../proposals/pdf');
const { MIME_PERMITIDOS } = require('./schema');

const LIMITE_BYTES = 15 * 1024 * 1024;
const MAX_DOWNLOADS_SIMULTANEOS = 6;
const MAX_DOWNLOADS_POR_CONTA = 2;
const ORCAMENTO_MEMORIA_BYTES = 48 * 1024 * 1024;
const TIMEOUT_MS = 25_000;
const MAX_REDIRECIONAMENTOS = 3;
const STATUS_REDIRECIONAMENTO = new Set([301, 302, 303, 307, 308]);
const TIPOS_GENERICOS = new Set(['application/octet-stream', 'binary/octet-stream']);
const TIPOS_XML = new Set(['application/xml', 'text/xml']);

function erroComCodigo(codigo) {
    const erro = new Error(codigo);
    erro.code = codigo;
    return erro;
}

// Reaproveita a allowlist já usada pelos PDFs de propostas: HTTPS, sem
// usuário/senha/porta, somente dl.airtable.com e *.airtableusercontent.com.
function destinoPermitido(url) {
    try {
        return allowedUrl(url);
    } catch (_) {
        throw erroComCodigo('DOC_DESTINATION_DENIED');
    }
}

function tipoBase(valor) {
    return String(valor || '').split(';')[0].trim().toLowerCase();
}

function tipoCompativel(recebido, esperado) {
    if (!recebido || recebido === esperado || TIPOS_GENERICOS.has(recebido)) return true;
    return TIPOS_XML.has(recebido) && TIPOS_XML.has(esperado);
}

function assinaturaConfere(mime, bytes) {
    if (!bytes.length) return false;
    if (mime === 'application/pdf') {
        return bytes.subarray(0, 5).toString('latin1') === '%PDF-'
            && bytes.subarray(-4096).includes(Buffer.from('%%EOF'));
    }
    if (mime === 'image/png') {
        return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (mime === 'image/jpeg') {
        return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    }
    if (TIPOS_XML.has(mime)) {
        const inicio = bytes.subarray(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart();
        return inicio.startsWith('<') && !/^<(?:!doctype\s+html|html)\b/i.test(inicio);
    }
    return false;
}

// Vagas de download: por conta (CNPJ da sessão) e no servidor, mais um
// orçamento de bytes compartilhado. `sair()` é idempotente e devolve tudo.
function criarLimitadorDownloads({
    maxSimultaneos = MAX_DOWNLOADS_SIMULTANEOS,
    maxPorConta = MAX_DOWNLOADS_POR_CONTA,
    orcamentoBytes = ORCAMENTO_MEMORIA_BYTES,
} = {}) {
    let ativos = 0;
    let bytesReservados = 0;
    const porConta = new Map();

    function entrar(conta) {
        const daConta = porConta.get(conta) || 0;
        if (daConta >= maxPorConta) return { ok: false, motivo: 'CONTA' };
        if (ativos >= maxSimultaneos) return { ok: false, motivo: 'SERVIDOR' };
        ativos += 1;
        porConta.set(conta, daConta + 1);
        let reservados = 0;
        let encerrada = false;
        return {
            ok: true,
            reservar(bytes) {
                if (encerrada || bytesReservados + bytes > orcamentoBytes) return false;
                bytesReservados += bytes;
                reservados += bytes;
                return true;
            },
            sair() {
                if (encerrada) return;
                encerrada = true;
                bytesReservados -= reservados;
                ativos -= 1;
                const restantes = (porConta.get(conta) || 1) - 1;
                if (restantes > 0) porConta.set(conta, restantes);
                else porConta.delete(conta);
            },
        };
    }

    return { entrar, situacao: () => ({ ativos, bytesReservados, contas: porConta.size }) };
}

function semLimite() {
    return true;
}

function ocupado(controller) {
    controller.abort();
    return erroComCodigo('DOC_BUSY');
}

// Com Content-Length confiável (sem compressão), o arquivo vai direto para um
// único buffer do tamanho declarado: memória ~1× o arquivo, sem cópias.
// Sem tamanho declarado, cada parte e a junção final entram no orçamento.
async function lerCorpoLimitado(resposta, controller, reservar) {
    const declarado = Number(resposta.headers.get('content-length'));
    if (!resposta.headers.get('content-encoding') && Number.isSafeInteger(declarado) && declarado > 0) {
        if (!reservar(declarado)) throw ocupado(controller);
        const destino = Buffer.allocUnsafe(declarado);
        let usado = 0;
        for await (const parte of resposta.body) {
            if (usado + parte.length > declarado) {
                controller.abort();
                throw erroComCodigo('DOC_CONTENT_INVALID');
            }
            destino.set(parte, usado);
            usado += parte.length;
        }
        return destino.subarray(0, usado);
    }

    const partes = [];
    let tamanho = 0;
    for await (const parte of resposta.body) {
        tamanho += parte.length;
        if (tamanho > LIMITE_BYTES) {
            controller.abort();
            throw erroComCodigo('DOC_TOO_LARGE');
        }
        if (!reservar(parte.length)) throw ocupado(controller);
        partes.push(Buffer.from(parte.buffer, parte.byteOffset, parte.byteLength));
    }
    if (!reservar(tamanho)) throw ocupado(controller);
    return Buffer.concat(partes, tamanho);
}

async function lerDocumento(url, mimeEsperado, fetcher = fetch, reservar = semLimite) {
    if (!Object.hasOwn(MIME_PERMITIDOS, mimeEsperado)) throw erroComCodigo('DOC_TYPE_INVALID');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        let destino = destinoPermitido(url);
        for (let saltos = 0; saltos <= MAX_REDIRECIONAMENTOS; saltos += 1) {
            const resposta = await fetcher(destino.href, { redirect: 'manual', signal: controller.signal });
            if (STATUS_REDIRECIONAMENTO.has(resposta.status)) {
                await resposta.body?.cancel();
                const location = resposta.headers.get('location');
                if (!location) throw erroComCodigo('DOC_REDIRECT_INVALID');
                destino = destinoPermitido(new URL(location, destino).href);
                continue;
            }
            if (!resposta.ok || !resposta.body) throw erroComCodigo('DOC_UNAVAILABLE');
            if (!tipoCompativel(tipoBase(resposta.headers.get('content-type')), mimeEsperado)) {
                await resposta.body.cancel();
                throw erroComCodigo('DOC_TYPE_INVALID');
            }
            if (Number(resposta.headers.get('content-length')) > LIMITE_BYTES) {
                await resposta.body.cancel();
                throw erroComCodigo('DOC_TOO_LARGE');
            }
            const bytes = await lerCorpoLimitado(resposta, controller, reservar);
            if (!assinaturaConfere(mimeEsperado, bytes)) throw erroComCodigo('DOC_CONTENT_INVALID');
            return { bytes, mime: mimeEsperado };
        }
        throw erroComCodigo('DOC_REDIRECT_LIMIT');
    } catch (error) {
        if (error.name === 'AbortError') throw erroComCodigo('DOC_TIMEOUT');
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

// Content-Disposition com nome ASCII de reserva e nome UTF-8 (RFC 6266/5987).
function disposicao(nome, modo) {
    const seguro = String(nome || 'documento')
        .replace(/[\u0000-\u001f\u007f"\\/]/g, '_')
        .slice(0, 160) || 'documento';
    const ascii = seguro
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7e]|[;%]/g, '_');
    const utf8 = encodeURIComponent(seguro).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    return `${modo === 'inline' ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

module.exports = {
    lerDocumento,
    disposicao,
    assinaturaConfere,
    criarLimitadorDownloads,
    LIMITE_BYTES,
    MAX_DOWNLOADS_SIMULTANEOS,
    MAX_DOWNLOADS_POR_CONTA,
    ORCAMENTO_MEMORIA_BYTES,
};
