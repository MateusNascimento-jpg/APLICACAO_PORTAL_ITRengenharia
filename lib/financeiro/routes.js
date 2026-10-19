'use strict';

// Rotas do Financeiro: somente GET. Não há endpoint de escrita, envio de
// e-mail, webhook ou marcação de pagamento nesta fase.

const { TIPOS_DOCUMENTO, MIME_PERMITIDOS } = require('./schema');
const { recordIdValido, anexoIdValido } = require('./mapper');
const { lerDocumento, disposicao, criarLimitadorDownloads } = require('./documentos');

const MENSAGENS = Object.freeze({
    NAO_DISPONIVEL: 'As informações financeiras não estão disponíveis para esta conta.',
    NAO_CONFIGURADO: 'A área financeira ainda não está configurada neste ambiente.',
    INDISPONIVEL: 'Não foi possível carregar suas informações financeiras. Tente novamente em instantes.',
    DOCUMENTO_NAO_ENCONTRADO: 'Documento não encontrado.',
    DOCUMENTO_INDISPONIVEL: 'Não foi possível abrir o documento agora. Tente novamente em instantes.',
    LIMITE: 'Aguarde alguns instantes antes de abrir mais documentos.',
    OCUPADO: 'Há documentos sendo abertos neste momento. Aguarde alguns instantes e tente novamente.',
});

// Somente contas reais da empresa. A visualização DEV (CNPJ arbitrário) e o
// Diretor não acessam faturamento por esta área.
const PAPEIS_PERMITIDOS = new Set(['Cliente', 'GeneratedClient']);

function papelPermitido(session) {
    return Boolean(session && PAPEIS_PERMITIDOS.has(session.role) && session.documento);
}

function escaparHtml(valor) {
    return String(valor).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Links de documento abrem em nova guia; nesse caso uma página simples é mais
// clara do que JSON. O conteúdo é sempre uma mensagem fixa deste arquivo.
function paginaErro(mensagem) {
    return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        + '<title>Documento indisponível — ITR Engenharia</title>'
        + '<link rel="stylesheet" href="/assets/css/financeiro.css"></head>'
        + '<body class="financeiro-documento-erro"><main><h1>Documento indisponível</h1>'
        + `<p>${escaparHtml(mensagem)}</p><p><a href="/portal.html">Voltar ao Portal</a></p></main></body></html>`;
}

function registerFinanceiroRoutes(app, {
    service, airtable, auth, client, consume, audit, hmac, fetcher, logger = console,
    limitadorDownloads = criarLimitadorDownloads(),
}) {
    const lerArquivo = (url, mime, reservar) => lerDocumento(url, mime, fetcher || fetch, reservar);

    function responderErro(req, res, status, mensagem, codigo) {
        res.set('Cache-Control', 'no-store');
        return res.status(status).json({ sucesso: false, erro: mensagem, codigo, requestId: req.requestId });
    }

    function responderErroDocumento(req, res, status, mensagem, codigo) {
        const navegacao = req.get('sec-fetch-dest') === 'document' || req.accepts(['json', 'html']) === 'html';
        if (!navegacao) return responderErro(req, res, status, mensagem, codigo);
        res.set('Cache-Control', 'no-store');
        return res.status(status).type('html').send(paginaErro(mensagem));
    }

    // Logs operacionais: requestId, código e, quando útil, o Record ID técnico.
    // Nunca CNPJ, nome de empresa, valores, URLs ou nomes de arquivos.
    function registrador(req) {
        return (codigo, registroId) => logger.warn(`[${req.requestId}] [FINANCEIRO] ${codigo}${registroId ? ` ${registroId}` : ''}`);
    }

    function codigoFalha(error) {
        return error?.code || (error?.status ? `HTTP_${error.status}` : error?.name || 'UNKNOWN');
    }

    app.get('/api/financeiro', auth, client, async (req, res) => {
        if (!papelPermitido(req.session)) return responderErro(req, res, 404, MENSAGENS.NAO_DISPONIVEL, 'FINANCE_NOT_AVAILABLE');
        if (!airtable.habilitado()) return responderErro(req, res, 503, MENSAGENS.NAO_CONFIGURADO, 'FINANCE_NOT_CONFIGURED');
        try {
            // Sempre consulta e autoriza agora; não há cache de painel no servidor.
            const painel = await service.carregarPainel(req.session.documento, { registrar: registrador(req) });
            if (!painel) return responderErro(req, res, 404, MENSAGENS.NAO_DISPONIVEL, 'FINANCE_NOT_AVAILABLE');
            res.set('Cache-Control', 'no-store');
            return res.json({ sucesso: true, financeiroHabilitado: true, ...painel });
        } catch (error) {
            logger.error(`[${req.requestId}] [FINANCEIRO] ${codigoFalha(error)}`);
            return responderErro(req, res, 503, MENSAGENS.INDISPONIVEL, 'FINANCE_UNAVAILABLE');
        }
    });

    app.get('/api/financeiro/documentos/:tipo/:registroId/:anexoId', auth, client, async (req, res) => {
        res.set('Referrer-Policy', 'no-referrer');
        const { tipo, registroId, anexoId } = req.params;
        const pedidoValido = Object.hasOwn(TIPOS_DOCUMENTO, tipo) && recordIdValido(registroId) && anexoIdValido(anexoId);
        if (!papelPermitido(req.session) || !pedidoValido) {
            return responderErroDocumento(req, res, 404, MENSAGENS.DOCUMENTO_NAO_ENCONTRADO, 'FINANCE_DOCUMENT_NOT_FOUND');
        }
        if (!airtable.habilitado()) {
            return responderErroDocumento(req, res, 503, MENSAGENS.NAO_CONFIGURADO, 'FINANCE_NOT_CONFIGURED');
        }

        try {
            const limite = await consume('finance-document', `${req.ip}:${req.session.documento}`, { limit: 30, windowMs: 60_000 });
            if (!limite.ok) {
                res.set('Retry-After', String(Math.max(1, Math.ceil((limite.retryAfterMs || 60_000) / 1000))));
                return responderErroDocumento(req, res, 429, MENSAGENS.LIMITE, 'RATE_LIMITED');
            }

            // Vaga de download (por conta e no servidor) liberada quando a resposta termina.
            const vaga = limitadorDownloads.entrar(req.session.documento);
            if (!vaga.ok) {
                res.set('Retry-After', '5');
                return responderErroDocumento(req, res, vaga.motivo === 'CONTA' ? 429 : 503, MENSAGENS.OCUPADO, 'FINANCE_DOCUMENT_BUSY');
            }
            res.once('close', vaga.sair);

            const anexo = await service.localizarDocumento(req.session.documento, tipo, registroId, anexoId, registrador(req));
            if (!anexo) {
                audit(req, 'finance_document_open', {
                    actorType: req.session.role,
                    actorId: hmac(req.session.documento),
                    outcome: 'denied',
                    metadata: { tipo },
                });
                return responderErroDocumento(req, res, 404, MENSAGENS.DOCUMENTO_NAO_ENCONTRADO, 'FINANCE_DOCUMENT_NOT_FOUND');
            }

            const arquivo = await lerArquivo(anexo.url, anexo.mime, vaga.reservar);
            const exibir = MIME_PERMITIDOS[arquivo.mime].exibir;
            res.set({
                'Content-Type': arquivo.mime === 'text/xml' ? 'application/xml' : arquivo.mime,
                'Content-Disposition': disposicao(anexo.nome, exibir ? 'inline' : 'attachment'),
                'Content-Length': String(arquivo.bytes.length),
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff',
            });
            audit(req, 'finance_document_open', {
                actorType: req.session.role,
                actorId: hmac(req.session.documento),
                targetType: anexo.alvo,
                targetId: registroId,
                outcome: 'success',
                metadata: { tipo },
            });
            return res.end(arquivo.bytes);
        } catch (error) {
            const codigo = codigoFalha(error);
            logger.error(`[${req.requestId}] [FINANCEIRO_DOCUMENTO] ${codigo}`);
            if (res.headersSent) return res.destroy();
            if (codigo === 'DOC_BUSY') {
                res.set('Retry-After', '5');
                return responderErroDocumento(req, res, 503, MENSAGENS.OCUPADO, 'FINANCE_DOCUMENT_BUSY');
            }
            const status = String(codigo).startsWith('DOC_') ? 502 : 503;
            return responderErroDocumento(req, res, status, MENSAGENS.DOCUMENTO_INDISPONIVEL, 'FINANCE_DOCUMENT_UNAVAILABLE');
        }
    });
}

module.exports = { registerFinanceiroRoutes, papelPermitido, MENSAGENS };
