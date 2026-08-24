const express = require('express');
const path = require('path');
const { Readable, Transform } = require('stream');

const config = require('./config');
const pool = require('./db');
const { verificarBanco, encerrarBanco } = require('./db');
const {
    buscarTrabalhosDoCliente,
    buscarClientePorCnpj,
    urlRelatorioAprovado,
    listarClientes,
    definirAprovacao,
    APROVACAO_VALIDAS,
    detalhesTrabalhosPorIds,
    recordIdValido,
    verificarAirtable
} = require('./airtable');
const { applySecurityHeaders, sameOriginOnly } = require('./lib/http-security');
const { cleanupSecurityState, scheduleMaintenance } = require('./lib/maintenance');
const { consume, reset, defensiveDelay } = require('./lib/rate-limit');
const { audit } = require('./lib/audit');
const {
    createSession,
    loadSession,
    destroySession,
    rotateSession,
    issueFreshCsrf,
    verifyCsrf,
    cleanupSessions
} = require('./lib/sessions');
const { scryptVerify, hmac } = require('./lib/security-crypto');

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');

if (config.security.trustProxyHops > 0) app.set('trust proxy', config.security.trustProxyHops);
app.disable('x-powered-by');
app.set('query parser', 'simple');

app.use((req, res, next) => {
    req.requestId = require('crypto').randomUUID();
    res.setHeader('X-Request-ID', req.requestId);
    next();
});
app.use(applySecurityHeaders);
app.use(express.json({ limit: '64kb', strict: true }));
app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    next();
});

function limparDocumento(doc) {
    return String(doc || '').replace(/\D/g, '');
}

function normalizarEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function emailValido(email) {
    const valor = String(email || '').trim();
    return valor.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor);
}

function erro(res, status, mensagem, codigo = null) {
    return res.status(status).json({
        sucesso: false,
        erro: mensagem,
        ...(codigo ? { codigo } : {}),
        requestId: res.req?.requestId
    });
}

function usuarioPublico(session) {
    return {
        perfil: session.role,
        documento: session.documento || null,
        airtableId: session.airtableId || null,
        email: session.email || null,
        nomeEmpresa: session.nomeEmpresa || null
    };
}

async function carregarSessao(req, res, next) {
    try {
        req.session = await loadSession(req);
        next();
    } catch (error) {
        console.error(`[${req.requestId}] [SESSION]`, error.message);
        return erro(res, 503, 'O serviço de sessão está temporariamente indisponível.', 'SESSION_UNAVAILABLE');
    }
}

function sessaoPresente(req, res, next) {
    if (!req.session) return erro(res, 401, 'Sua sessão expirou. Entre novamente.', 'SESSION_REQUIRED');
    next();
}

function autenticado(req, res, next) {
    if (!req.session || !['Cliente', 'Director'].includes(req.session.role)) {
        return erro(res, 401, 'Sua sessão expirou. Entre novamente.', 'SESSION_REQUIRED');
    }
    next();
}

function somenteDiretor(req, res, next) {
    if (!req.session || req.session.role !== 'Director') {
        return erro(res, 403, 'Acesso não autorizado.', 'DIRECTOR_REQUIRED');
    }
    next();
}

function roleExata(role) {
    return (req, res, next) => {
        if (!req.session || req.session.role !== role) {
            return erro(res, 403, 'Etapa de autenticação inválida ou expirada.', 'AUTH_STAGE_INVALID');
        }
        next();
    };
}

function csrfProtegido(req, res, next) {
    const token = req.get('x-csrf-token');
    if (!verifyCsrf(req.session, token)) {
        return erro(res, 403, 'A requisição de segurança expirou. Atualize a página e tente novamente.', 'CSRF_INVALID');
    }
    next();
}

function escritaHabilitada(req, res, next) {
    if (config.security.safeMode || !config.security.writeEnabled) {
        return erro(res, 423, 'O portal está em modo seguro de validação. Alterações estão bloqueadas.', 'SAFE_MODE');
    }
    next();
}

function retryAfter(res, rl) {
    const segundos = Math.max(1, Math.ceil((rl.retryAfterMs || 60000) / 1000));
    res.setHeader('Retry-After', String(segundos));
    return segundos;
}

async function consumirLimitesCliente(req, documento) {
    const windowMs = 15 * 60 * 1000;
    const ip = await consume('client-login-ip', req.ip || 'unknown', {
        limit: config.security.loginIpLimit,
        windowMs,
        blockMs: windowMs
    });
    if (!ip.ok) return ip;
    return consume('client-login-account', documento, {
        limit: config.security.loginAccountLimit,
        windowMs,
        blockMs: windowMs
    });
}

async function consumirLimiteMfa(req) {
    const rawKey = req.session?.hash || req.ip || 'unknown';
    return consume('director-mfa', rawKey, {
        limit: config.security.directorMfaLimit,
        windowMs: 10 * 60 * 1000,
        blockMs: 10 * 60 * 1000
    });
}

async function consumirLimiteDiretor(req, username) {
    const windowMs = 20 * 60 * 1000;
    const ip = await consume('director-login-ip', req.ip || 'unknown', {
        limit: config.security.directorLoginLimit,
        windowMs,
        blockMs: windowMs
    });
    if (!ip.ok) return ip;
    return consume('director-login-account', username, {
        limit: config.security.directorLoginLimit,
        windowMs,
        blockMs: windowMs
    });
}

async function registrarUltimoAcesso(cliente) {
    try {
        await pool.query(
            `INSERT INTO ultimo_acesso_cliente (cnpj, airtable_client_id, ultimo_acesso)
             VALUES (?, ?, NOW())
             ON DUPLICATE KEY UPDATE ultimo_acesso = NOW(), airtable_client_id = VALUES(airtable_client_id)`,
            [cliente.cnpj, cliente.id]
        );
    } catch (error) {
        console.warn('[ULTIMO_ACESSO] Não foi possível atualizar:', error.message);
    }
}

async function registrarDownload(cnpj, recordIdTrabalho) {
    if (!cnpj) return;
    try {
        await pool.query(
            `INSERT INTO relatorios_baixados (cnpj, record_id_trabalho)
             SELECT ?, ? FROM DUAL
             WHERE NOT EXISTS (
               SELECT 1 FROM relatorios_baixados
               WHERE cnpj = ? AND record_id_trabalho = ?
             )`,
            [cnpj, recordIdTrabalho, cnpj, recordIdTrabalho]
        );
    } catch (error) {
        console.warn('[DOWNLOAD] Não foi possível registrar:', error.message);
    }
}

// ---------- Saúde e arquivos públicos ----------
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/status', (req, res) => res.json({ status: 'Online' }));
app.get('/ready', async (req, res) => {
    try {
        await Promise.all([verificarBanco(), verificarAirtable()]);
        return res.json({ ok: true });
    } catch (_) {
        return res.status(503).json({ ok: false });
    }
});
app.get('/', (req, res) => res.redirect(302, '/login.html'));
app.get(['/cadastro', '/cadastro.html'], (req, res) => res.redirect(308, '/login.html'));
app.post(['/api/cadastro', '/cadastro'], (req, res) =>
    erro(res, 410, 'O cadastro público foi descontinuado. Use o CNPJ e o e-mail cadastrados na ITR.')
);

app.use(express.static(PUBLIC_DIR, {
    index: false,
    etag: true,
    maxAge: 0,
    setHeaders(res, filePath) {
        if (/\.html?$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'no-store');
        } else if (/\.(?:css|js)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'no-cache');
        } else if (/\.(?:png|svg|webp)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=3600');
        } else {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// Todas as rotas abaixo podem usar sessão por cookie.
app.use('/api', carregarSessao);

// ---------- Login do cliente: CNPJ + e-mail, preservado por compatibilidade ----------
app.post('/api/login', sameOriginOnly, async (req, res) => {
    const documento = limparDocumento(req.body?.documento);
    const email = normalizarEmail(req.body?.email || req.body?.senha);
    const remember = Boolean(req.body?.remember || req.body?.lembrar);

    if (documento.length !== 14 || !emailValido(email)) {
        await defensiveDelay();
        return erro(res, 401, 'Não foi possível validar os dados informados.', 'INVALID_CREDENTIALS');
    }

    try {
        const rl = await consumirLimitesCliente(req, documento);
        if (!rl.ok) {
            retryAfter(res, rl);
            await audit(req, 'client_login', { actorType: 'Cliente', actorId: hmac(documento), outcome: 'rate_limited' });
            return erro(res, 429, 'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.', 'RATE_LIMITED');
        }

        const cliente = await buscarClientePorCnpj(documento);
        const valido = cliente && cliente.emailLogin && normalizarEmail(cliente.emailLogin) === email;
        if (!valido) {
            await defensiveDelay();
            await audit(req, 'client_login', { actorType: 'Cliente', actorId: hmac(documento), outcome: 'denied' });
            return erro(res, 401, 'Não foi possível validar os dados informados.', 'INVALID_CREDENTIALS');
        }

        if (req.session) await destroySession(req, res);
        const sessao = await createSession(req, res, {
            role: 'Cliente',
            airtableId: cliente.id,
            documento: cliente.cnpj,
            email: cliente.emailLogin,
            nomeEmpresa: cliente.idCliente || cliente.nome || null
        }, { remember });

        await Promise.allSettled([
            reset('client-login-account', documento),
            registrarUltimoAcesso(cliente),
            audit(req, 'client_login', { actorType: 'Cliente', actorId: hmac(documento), outcome: 'success' })
        ]);

        return res.json({
            sucesso: true,
            perfil: 'Cliente',
            usuario: {
                perfil: 'Cliente',
                documento: cliente.cnpj,
                airtableId: cliente.id,
                email: cliente.emailLogin,
                nomeEmpresa: cliente.idCliente || cliente.nome || null
            },
            csrfToken: sessao.csrfToken
        });
    } catch (error) {
        console.error(`[${req.requestId}] [LOGIN_CLIENTE]`, error.message);
        return erro(res, 503, 'Não foi possível concluir o acesso agora. Tente novamente em instantes.', 'LOGIN_UNAVAILABLE');
    }
});

// ---------- Login separado do único Diretor ----------
app.post('/api/diretor/login', sameOriginOnly, async (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!/^[a-z0-9._-]{3,64}$/.test(username) || password.length < 12 || password.length > 256) {
        await defensiveDelay();
        return erro(res, 401, 'Credenciais administrativas inválidas.', 'INVALID_CREDENTIALS');
    }
    try {
        const rl = await consumirLimiteDiretor(req, username);
        if (!rl.ok) {
            retryAfter(res, rl);
            await audit(req, 'director_login', { actorType: 'Diretor', actorId: username, outcome: 'rate_limited' });
            return erro(res, 429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.', 'RATE_LIMITED');
        }
        const [rows] = await pool.query('SELECT * FROM portal_director WHERE id = 1 AND username = ? LIMIT 1', [username]);
        const diretor = rows[0];
        const senhaOk = diretor ? await scryptVerify(password, diretor.password_salt, diretor.password_hash) : false;
        if (!diretor || !senhaOk) {
            await defensiveDelay();
            await audit(req, 'director_login', { actorType: 'Diretor', actorId: username, outcome: 'denied' });
            return erro(res, 401, 'Credenciais administrativas inválidas.', 'INVALID_CREDENTIALS');
        }
        if (req.session) await destroySession(req, res);
        const sessao = await createSession(req, res, { role: 'Director', documento: 'diretor', nomeEmpresa: 'ITR Engenharia' });
        await Promise.allSettled([
            reset('director-login-account', username),
            reset('director-login-ip', req.ip || 'unknown'),
            pool.query('UPDATE portal_director SET last_login_at = NOW(3) WHERE id = 1'),
            audit(req, 'director_login', { actorType: 'Diretor', actorId: username, outcome: 'success' })
        ]);
        return res.json({ sucesso: true, perfil: 'Director', csrfToken: sessao.csrfToken });
    } catch (error) {
        console.error(`[${req.requestId}] [LOGIN_DIRETOR]`, error.message);
        return erro(res, 503, 'Não foi possível concluir o acesso administrativo agora.', 'LOGIN_UNAVAILABLE');
    }
});

// ---------- Sessão ----------
app.get('/api/perfil', autenticado, (req, res) => {
    return res.json({ sucesso: true, usuario: usuarioPublico(req.session) });
});
// Alias legado: carrega a sessão explicitamente porque está fora do prefixo /api.
app.get('/perfil', carregarSessao, autenticado, (req, res) => {
    return res.json({ sucesso: true, usuario: usuarioPublico(req.session) });
});

app.get('/api/csrf', sessaoPresente, async (req, res) => {
    try {
        const csrfToken = await issueFreshCsrf(req.session);
        return res.json({ sucesso: true, csrfToken });
    } catch (error) {
        console.error(`[${req.requestId}] [CSRF]`, error.message);
        return erro(res, 503, 'Não foi possível renovar a sessão de segurança.');
    }
});

app.post('/api/logout', sameOriginOnly, csrfProtegido, async (req, res) => {
    try {
        const actor = req.session?.role || null;
        await destroySession(req, res);
        await audit(req, 'logout', { actorType: actor, outcome: 'success' });
        return res.json({ sucesso: true });
    } catch (error) {
        console.error(`[${req.requestId}] [LOGOUT]`, error.message);
        return erro(res, 500, 'Não foi possível encerrar a sessão.');
    }
});

app.get('/api/runtime', autenticado, (req, res) => {
    res.json({
        sucesso: true,
        safeMode: config.security.safeMode || !config.security.writeEnabled,
        ambiente: config.nodeEnv
    });
});

// ---------- Portal do Cliente ----------
async function responderTrabalhosCliente(req, res, mesesPadrao) {
    try {
        if (!req.session.airtableId) return erro(res, 403, 'Seu acesso não possui vínculo de cliente válido.');
        const modo = req.query.modo === 'todos' ? 'todos' : 'recente';
        const dados = await buscarTrabalhosDoCliente(req.session.airtableId, null, modo, mesesPadrao);
        return res.json({ sucesso: true, ...dados });
    } catch (error) {
        console.error(`[${req.requestId}] [TRABALHOS_CLIENTE]`, error.message);
        return erro(res, 503, 'Os dados operacionais estão temporariamente indisponíveis. Tente novamente em instantes.', 'AIRTABLE_UNAVAILABLE');
    }
}

app.get('/api/meus-dados', autenticado, (req, res) => responderTrabalhosCliente(req, res, 3));
app.get('/api/trabalhos', autenticado, (req, res) => responderTrabalhosCliente(req, res, 3));

function validarUrlAirtable(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return false;
        const host = parsed.hostname.toLowerCase();
        return host === 'dl.airtable.com'
            || host.endsWith('.airtable.com')
            || host === 'airtableusercontent.com'
            || host.endsWith('.airtableusercontent.com');
    } catch (_) {
        return false;
    }
}

async function obterPdfAutorizado(req) {
    const id = req.params.id;
    if (!recordIdValido(id)) return null;
    const clientId = req.session.role === 'Cliente' ? req.session.airtableId : null;
    return urlRelatorioAprovado(id, clientId);
}

app.get('/api/trabalho/:id/download', autenticado, async (req, res) => {
    try {
        const pdf = await obterPdfAutorizado(req);
        if (!pdf?.url) return erro(res, 404, 'Este relatório não está disponível para download.');
        return res.json({
            sucesso: true,
            arquivo: pdf.nome,
            url: `/api/relatorio/${encodeURIComponent(req.params.id)}`
        });
    } catch (error) {
        console.error(`[${req.requestId}] [DOWNLOAD_INFO]`, error.message);
        return erro(res, 503, 'Não foi possível preparar o relatório agora.');
    }
});

app.get('/api/relatorio/:id', autenticado, async (req, res) => {
    let controller;
    try {
        const pdf = await obterPdfAutorizado(req);
        if (!pdf?.url || !validarUrlAirtable(pdf.url)) return erro(res, 404, 'Este relatório não está disponível para download.');

        controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        let atual = pdf.url;
        let upstream = null;
        // Segue poucos redirecionamentos e valida cada destino. Isso evita que uma
        // URL legítima do Airtable seja usada como ponte para outro host (SSRF).
        for (let salto = 0; salto < 4; salto += 1) {
            if (!validarUrlAirtable(atual)) throw new Error('Destino de relatório não permitido.');
            upstream = await fetch(atual, { signal: controller.signal, redirect: 'manual' });
            if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
            const location = upstream.headers.get('location');
            if (!location) throw new Error('Redirecionamento de relatório inválido.');
            atual = new URL(location, atual).toString();
            upstream.body?.cancel?.();
        }
        clearTimeout(timer);
        if (!upstream || [301, 302, 303, 307, 308].includes(upstream.status)) {
            return erro(res, 502, 'O arquivo do relatório não pôde ser validado.');
        }
        if (!upstream.ok || !upstream.body) return erro(res, 502, 'O arquivo do relatório está temporariamente indisponível.');
        const tipoUpstream = String(upstream.headers.get('content-type') || '').toLowerCase();
        if (tipoUpstream && !tipoUpstream.includes('pdf') && !tipoUpstream.includes('octet-stream')) {
            upstream.body.cancel?.();
            return erro(res, 502, 'O arquivo recebido não corresponde a um PDF válido.');
        }

        const limiteBytes = 50 * 1024 * 1024;
        const tamanho = Number(upstream.headers.get('content-length') || 0);
        if (tamanho > limiteBytes) return erro(res, 413, 'O relatório excede o limite permitido para download pelo portal.');

        const filename = String(pdf.nome || 'relatorio.pdf').replace(/[\r\n"]/g, '_');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');

        // Também limita respostas sem Content-Length. O contador impede que um
        // upstream anômalo consuma memória/banda indefinidamente.
        let recebidos = 0;
        const limitador = new Transform({
            transform(chunk, _encoding, callback) {
                recebidos += chunk.length;
                if (recebidos > limiteBytes) return callback(new Error('PDF excedeu o limite de 50 MB.'));
                callback(null, chunk);
            }
        });

        let concluido = false;
        const streamTimer = setTimeout(() => controller.abort(), 120000);
        res.once('finish', () => {
            concluido = true;
            clearTimeout(streamTimer);
            Promise.allSettled([
                registrarDownload(req.session.role === 'Cliente' ? req.session.documento : null, req.params.id),
                audit(req, 'report_download', {
                    actorType: req.session.role,
                    actorId: req.session.role === 'Cliente' ? hmac(req.session.documento) : 'diretor',
                    targetType: 'Trabalho',
                    targetId: req.params.id,
                    outcome: 'success'
                })
            ]).catch(() => {});
        });
        res.once('close', () => { if (!concluido) clearTimeout(streamTimer); });

        Readable.fromWeb(upstream.body)
            .on('error', error => {
                console.error(`[${req.requestId}] [PDF_STREAM]`, error.message);
                if (!res.headersSent) res.status(502).end();
                else res.destroy(error);
            })
            .pipe(limitador)
            .on('error', error => {
                console.error(`[${req.requestId}] [PDF_LIMIT]`, error.message);
                controller.abort();
                if (!res.headersSent) res.status(413).end();
                else res.destroy(error);
            })
            .pipe(res);
    } catch (error) {
        if (error.name !== 'AbortError') console.error(`[${req.requestId}] [DOWNLOAD_PDF]`, error.message);
        if (!res.headersSent) return erro(res, 503, 'Não foi possível abrir o relatório agora.');
    }
});

// ---------- Painel do Diretor ----------
async function responderClientesDiretor(req, res) {
    try {
        const clientes = await listarClientes();
        return res.json({ sucesso: true, clientes });
    } catch (error) {
        console.error(`[${req.requestId}] [DIRETOR_CLIENTES]`, error.message);
        return erro(res, 503, 'Não foi possível carregar a lista de clientes agora.');
    }
}
app.get('/api/diretor/clientes', autenticado, somenteDiretor, responderClientesDiretor);
app.get('/api/clientes', autenticado, somenteDiretor, responderClientesDiretor);

async function responderTrabalhosDiretor(req, res) {
    const recordIdCliente = req.params.clienteId || req.params.id;
    if (!recordIdValido(recordIdCliente)) return erro(res, 400, 'Cliente inválido.');
    try {
        const modo = req.query.modo === 'todos' ? 'todos' : 'recente';
        const dados = await buscarTrabalhosDoCliente(recordIdCliente, null, modo, 6);
        return res.json({ sucesso: true, ...dados });
    } catch (error) {
        console.error(`[${req.requestId}] [DIRETOR_TRABALHOS]`, error.message);
        return erro(res, 503, 'Não foi possível carregar os trabalhos deste cliente agora.');
    }
}
app.get('/api/diretor/trabalhos/:clienteId', autenticado, somenteDiretor, responderTrabalhosDiretor);
app.get('/api/cliente/:id/trabalhos', autenticado, somenteDiretor, responderTrabalhosDiretor);

app.patch('/api/trabalho/:id/aprovacao', sameOriginOnly, autenticado, somenteDiretor, csrfProtegido, escritaHabilitada, async (req, res) => {
    const recordIdTrabalho = req.params.id;
    const valor = String(req.body?.valor || '').trim();
    if (!recordIdValido(recordIdTrabalho)) return erro(res, 400, 'Trabalho inválido.');
    if (!APROVACAO_VALIDAS.includes(valor)) return erro(res, 400, 'Valor de aprovação inválido.');

    try {
        const resultado = await definirAprovacao(recordIdTrabalho, valor);
        await audit(req, 'director_approval_change', {
            actorType: 'Diretor',
            actorId: 'diretor',
            targetType: 'Trabalho',
            targetId: recordIdTrabalho,
            outcome: 'success',
            metadata: { anterior: resultado.anterior, novo: valor }
        });
        const mensagem = valor === 'Aprovado'
            ? 'Relatório aprovado. O cliente poderá visualizá-lo quando a automação do Airtable concluir a publicação.'
            : valor === 'Refazer'
                ? 'Relatório marcado para refação.'
                : 'Relatório marcado como em andamento.';
        return res.json({ sucesso: true, mensagem, id: resultado.id, aprovacao: resultado.aprovacao });
    } catch (error) {
        console.error(`[${req.requestId}] [APROVACAO]`, error.message);
        await audit(req, 'director_approval_change', {
            actorType: 'Diretor', actorId: 'diretor', targetType: 'Trabalho', targetId: recordIdTrabalho, outcome: 'error'
        });
        return erro(res, 503, 'Não foi possível atualizar a aprovação agora.');
    }
});

app.get('/api/diretor/downloads', autenticado, somenteDiretor, async (req, res) => {
    try {
        const limite = Math.max(1, Math.min(Number(req.query.limit) || 500, 1000));
        const [linhas] = await pool.query(
            `SELECT cnpj, record_id_trabalho, baixado_em FROM relatorios_baixados
             ORDER BY baixado_em DESC LIMIT ?`,
            [limite]
        );

        let mapaEmpresaPorCnpj = {};
        try {
            const clientes = await listarClientes();
            clientes.forEach(c => { if (c.cnpj) mapaEmpresaPorCnpj[c.cnpj] = c.nome; });
        } catch (_) {}

        const detalhes = await detalhesTrabalhosPorIds(linhas.map(l => l.record_id_trabalho), 5);
        const downloads = linhas.map(linha => {
            const detalhe = detalhes.get(linha.record_id_trabalho) || {};
            return {
                cnpj: linha.cnpj,
                empresa: mapaEmpresaPorCnpj[linha.cnpj] || null,
                record_id: linha.record_id_trabalho,
                os: detalhe.os || null,
                id_trabalho: detalhe.id_trabalho || null,
                baixado_em: linha.baixado_em
            };
        });
        return res.json({ sucesso: true, downloads });
    } catch (error) {
        console.error(`[${req.requestId}] [DIRETOR_DOWNLOADS]`, error.message);
        return erro(res, 503, 'Não foi possível carregar o histórico de downloads agora.');
    }
});

// Rotas antigas de recuperação não devem reativar credenciais obsoletas.
app.post(['/api/esqueci-senha', '/api/redefinir-senha'], (req, res) =>
    erro(res, 410, 'Este fluxo foi descontinuado.')
);

app.use('/api', (req, res) => erro(res, 404, 'Rota da API não encontrada.'));

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.type === 'entity.too.large') {
        return erro(res, 413, 'A requisição excede o tamanho permitido.', 'PAYLOAD_TOO_LARGE');
    }
    if (error instanceof SyntaxError && Object.prototype.hasOwnProperty.call(error, 'body')) {
        return erro(res, 400, 'O corpo da requisição não contém JSON válido.', 'INVALID_JSON');
    }
    console.error(`[${req.requestId}] [UNHANDLED]`, error?.stack || error?.message || error);
    return erro(res, 500, 'Ocorreu um erro interno inesperado. Tente novamente.', 'INTERNAL_ERROR');
});

let server;
async function iniciar() {
    await verificarBanco();
    await cleanupSessions().catch(() => {});
    await cleanupSecurityState().catch(() => {});
    scheduleMaintenance();
    server = app.listen(config.port, () => {
        console.log('===================================================');
        console.log(` Portal ITR: http://localhost:${config.port}`);
        console.log(` Ambiente: ${config.nodeEnv}`);
        console.log(` Modo seguro: ${config.security.safeMode || !config.security.writeEnabled ? 'ATIVO' : 'desativado'}`);
        console.log('===================================================');
    });
}

async function shutdown(signal) {
    console.log(`[SHUTDOWN] ${signal}: encerrando conexões...`);
    if (server) {
        await new Promise(resolve => server.close(resolve));
    }
    await encerrarBanco().catch(() => {});
    process.exit(0);
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
    iniciar().catch(error => {
        console.error('[BOOT] O servidor não pôde iniciar:', error.message);
        process.exit(1);
    });
}

module.exports = { app, iniciar };
