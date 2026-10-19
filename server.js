const express = require('express');
const path = require('path');
const { Readable, Transform } = require('stream');

const config = require('./config');
const pool = require('./db');
const { verificarBanco, encerrarBanco } = require('./db');
const {
    buscarTrabalhosDoCliente,
    temTrabalhosAutorizados,
    buscarClientePorCnpj,
    buscarIdentidadeAcesso,
    buscarContatosConta,
    buscarClientePorId,
    resolverEscopoCliente,
    carregarScopeSnapshot,
    urlRelatorioAprovado,
    relatoriosAprovados,
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
const { createInMemoryGuard } = require('./lib/abuse-guard');
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
const { scryptVerify, hmac, sha256, safeEqualHex } = require('./lib/security-crypto');
const {
    PURPOSE_ACTIVATE,
    PURPOSE_RESET,
    getAccount,
    verifyPassword,
    findScopeAccount,
    verifyPasswordInScope,
    touchLogin,
    createPasswordToken,
    peekPasswordToken,
    activateAccount,
    resetPasswordWithToken,
    changePassword,
    onboardingState,
    markOnboarding
} = require('./lib/client-auth');
const { sendSecurityNotification } = require('./lib/notifications');
const {
    habilitado: financeiroHabilitado,
    listarPropostasPorCnpj,
    obterDocumentoProposta
} = require('./finance-airtable');
const { financeiroVisivel } = require('./lib/financeiro');

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');
const apiBurstGuard = createInMemoryGuard({ limit: config.security.apiBurstPerMinute, windowMs: 60_000 });
const loginBurstGuard = createInMemoryGuard({ limit: config.security.loginBurstPerMinute, windowMs: 60_000 });

if (config.security.trustProxyHops > 0) app.set('trust proxy', config.security.trustProxyHops);
app.disable('x-powered-by');
app.set('query parser', 'simple');

app.use((req, res, next) => {
    req.requestId = require('crypto').randomUUID();
    res.setHeader('X-Request-ID', req.requestId);
    next();
});
app.use(applySecurityHeaders);
app.use(express.json({
    limit: '64kb',
    strict: true,
    verify(req, res, body) {
        if (req.path === '/internal/proposals/airtable-webhook') req.proposalsRawBody = body;
    }
}));
app.use(['/api', '/perfil'], (req, res, next) => {
    const rl = apiBurstGuard.consume(req.ip || 'unknown');
    if (!rl.ok) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(rl.retryAfterMs / 1000))));
        return erro(res, 429, 'Muitas requisições. Aguarde alguns instantes.', 'RATE_LIMITED');
    }
    next();
});
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
        perfil: ['GeneratedClient', 'DevViewer'].includes(session.role) ? 'Cliente' : session.role,
        visualizacaoDev: session.role === 'DevViewer',
        documento: session.documento || null,
        airtableId: session.airtableId || null,
        email: session.email || null,
        nomeEmpresa: session.nomeEmpresa || null
    };
}

async function usuarioPublicoComEstado(session) {
    const usuario = usuarioPublico(session);
    if (config.clientAuth.mode !== 'generated' && config.clientAuth.enabled && session.role === 'Cliente' && session.airtableId) {
        const onboarding = await onboardingState(session.airtableId);
        usuario.seguranca = {
            senhaPessoalAtiva: Boolean(onboarding),
            onboardingVersion: onboarding?.version || 0,
            onboardingTargetVersion: config.clientAuth.onboardingVersion,
            onboardingCompletedAt: onboarding?.completedAt || null,
            onboardingDismissedAt: onboarding?.dismissedAt || null
        };
    } else {
        usuario.seguranca = {
            senhaPessoalAtiva: false,
            onboardingVersion: 0,
            onboardingTargetVersion: config.clientAuth.onboardingVersion
        };
    }
    return usuario;
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
    if (!req.session || !['Cliente', 'GeneratedClient', 'DevViewer', 'Director'].includes(req.session.role)) {
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

function somenteCliente(req, res, next) {
    if (!req.session || req.session.role !== 'Cliente') {
        return erro(res, 403, 'Acesso não autorizado.', 'CLIENT_REQUIRED');
    }
    next();
}

function somenteClientePortal(req, res, next) {
    if (!req.session || !['Cliente', 'GeneratedClient', 'DevViewer'].includes(req.session.role)) {
        return erro(res, 403, 'Acesso não autorizado.', 'CLIENT_REQUIRED');
    }
    if (!req.session.documento) {
        return erro(res, 403, 'Sua sessão não possui uma empresa válida.', 'CLIENT_REQUIRED');
    }
    next();
}

function senhasClientesHabilitadas(req, res, next) {
    if (config.clientAuth.mode === 'generated') return erro(res, 410, 'Use CNPJ e a senha de acesso enviada pela ITR.', 'GENERATED_ACCESS');
    if (!config.clientAuth.enabled) {
        return erro(res, 404, 'Este recurso ainda não está habilitado.', 'FEATURE_DISABLED');
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

async function consumirLimitesRecuperacao(req, documento) {
    const windowMs = 30 * 60 * 1000;
    const ip = await consume('client-password-request-ip', req.ip || 'unknown', {
        limit: config.clientAuth.requestIpLimit,
        windowMs,
        blockMs: windowMs
    });
    if (!ip.ok) return ip;
    return consume('client-password-request-account', documento || 'unknown', {
        limit: config.clientAuth.requestAccountLimit,
        windowMs,
        blockMs: windowMs
    });
}

async function consumirLimiteConfirmacaoSenha(req) {
    const windowMs = 30 * 60 * 1000;
    return consume('client-password-confirm-ip', req.ip || 'unknown', {
        limit: config.clientAuth.confirmIpLimit,
        windowMs,
        blockMs: windowMs
    });
}

function respostaRecuperacaoGenerica(res) {
    return res.status(202).json({
        sucesso: true,
        mensagem: 'Solicitação recebida. Se o CNPJ estiver cadastrado com e-mails válidos, enviaremos os dados de acesso para esses contatos. Confira sua caixa de entrada e a pasta de spam ou lixo eletrônico. O envio pode levar alguns minutos. Se não receber, confira o CNPJ informado ou entre em contato com a ITR. Sua senha atual continua a mesma.'
    });
}

function senhaInformada(req) {
    return String(req.body?.senha ?? req.body?.password ?? req.body?.email ?? '');
}

function credenciaisDevValidas(username, password) {
    if (!config.devViewer.enabled) return false;
    const userOk = safeEqualHex(sha256(String(username || '').trim().toLowerCase()), sha256(config.devViewer.username));
    const passwordOk = safeEqualHex(sha256(String(password || '')), sha256(config.devViewer.password));
    return userOk && passwordOk;
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
async function verificarEstruturasCriticas() {
    const obrigatorias = ['portal_sessions', 'portal_rate_limits', 'portal_audit_events', 'portal_director', 'ultimo_acesso_cliente', 'relatorios_baixados'];
    obrigatorias.push('portal_proposal_state', 'portal_proposal_challenges', 'portal_proposal_outbox', 'portal_proposal_settings', 'portal_proposal_nonces');
    if (config.clientAuth.mode !== 'generated' && config.clientAuth.enabled) obrigatorias.push('portal_client_accounts', 'portal_password_tokens');
    const placeholders = obrigatorias.map(() => '?').join(',');
    const [rows] = await pool.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})`,
        obrigatorias
    );
    const presentes = new Set(rows.map(row => row.TABLE_NAME));
    const faltantes = obrigatorias.filter(nome => !presentes.has(nome));
    if (faltantes.length) throw new Error(`Estruturas obrigatórias ausentes: ${faltantes.join(', ')}`);
}

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/status', (req, res) => res.json({ status: 'Online' }));
let readinessCache = { checkedAt: 0, ok: false, pending: null };
app.get('/ready', async (req, res) => {
    const now = Date.now();
    if (now - readinessCache.checkedAt < config.security.readinessCacheMs) {
        return res.status(readinessCache.ok ? 200 : 503).json({ ok: readinessCache.ok });
    }
    try {
        if (!readinessCache.pending) {
            readinessCache.pending = Promise.all([verificarBanco(), verificarAirtable(), verificarEstruturasCriticas()])
                .then(() => { readinessCache = { checkedAt: Date.now(), ok: true, pending: null }; })
                .catch(error => { readinessCache = { checkedAt: Date.now(), ok: false, pending: null }; throw error; });
        }
        await readinessCache.pending;
        return res.json({ ok: true });
    } catch (error) {
        console.error(`[${req.requestId}] [READY]`, error.message);
        return res.status(503).json({ ok: false });
    }
});
app.get('/', (req, res) => res.redirect(302, '/login.html'));
app.get(['/cadastro', '/cadastro.html'], (req, res) => res.redirect(308, '/login.html'));
app.post(['/api/cadastro', '/cadastro'], (req, res) =>
    erro(res, 410, 'O cadastro público foi descontinuado. Use o CNPJ e a senha de acesso da ITR.')
);

app.get(['/criar-senha.html', '/redefinir-senha.html'], (req, res, next) => config.clientAuth.mode === 'generated' ? res.redirect(302, '/recuperar-senha.html') : next());
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

// Configuração pública mínima para o frontend. Não contém segredo.
app.get('/api/public-config', (req, res) => {
    return res.json({
        sucesso: true,
        clientPasswordsEnabled: true,
        clientAuthMode: config.clientAuth.mode,
        passwordMinLength: config.clientAuth.passwordMinLength,
        onboardingVersion: config.clientAuth.onboardingVersion
    });
});

// Todas as rotas abaixo podem usar sessão por cookie.
app.use('/api', carregarSessao);

// ---------- Visualização DEV do Portal do Cliente ----------
// Rota separada do login normal. O DEV informa suas próprias credenciais e o
// CNPJ-alvo; após validação, criamos uma sessão comum de Cliente para reutilizar
// exatamente portal.html, /api/meus-dados e as mesmas regras de escopo/PDF.
app.post('/api/dev/login', sameOriginOnly, async (req, res) => {
    if (!config.devViewer.enabled) {
        return erro(res, 404, 'Visualização DEV não habilitada.', 'DEV_VIEWER_DISABLED');
    }

    const cheapRl = loginBurstGuard.consume(`dev:${req.ip || 'unknown'}`);
    if (!cheapRl.ok) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(cheapRl.retryAfterMs / 1000))));
        return erro(res, 429, 'Muitas tentativas. Aguarde alguns instantes.', 'RATE_LIMITED');
    }

    const devRl = await consume('dev-login-ip', req.ip || 'unknown', { limit: 10, windowMs: 900000 });
    if (!devRl.ok) { retryAfter(res, devRl); return erro(res, 429, 'Muitas tentativas DEV.', 'RATE_LIMITED'); }
    const username = String(req.body?.username || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const documento = limparDocumento(req.body?.documento);
    const devAccountRl = await consume('dev-login-account', username || 'invalid', { limit: 10, windowMs: 900000 });
    if (!devAccountRl.ok) { retryAfter(res, devAccountRl); return erro(res, 429, 'Muitas tentativas DEV.', 'RATE_LIMITED'); }

    if (documento.length !== 14 || !credenciaisDevValidas(username, password)) {
        await defensiveDelay();
        await audit(req, 'dev_viewer_login', { actorType: 'DevViewer', actorId: hmac(username || 'invalid'), outcome: 'denied' });
        return erro(res, 401, 'Login DEV, senha ou CNPJ inválidos.', 'INVALID_CREDENTIALS');
    }

    try {
        const cliente = await buscarClientePorCnpj(documento);
        if (!cliente) {
            await defensiveDelay();
            await audit(req, 'dev_viewer_login', { actorType: 'DevViewer', actorId: hmac(username), outcome: 'target_not_found' });
            return erro(res, 401, 'Login DEV, senha ou CNPJ inválidos.', 'INVALID_CREDENTIALS');
        }

        if (req.session) await destroySession(req, res);
        const sessao = await createSession(req, res, {
            role: 'DevViewer',
            airtableId: cliente.id,
            documento: cliente.cnpj,
            email: null,
            nomeEmpresa: cliente.idCliente || cliente.nome || null
        });

        await audit(req, 'dev_viewer_login', {
            actorType: 'DevViewer',
            actorId: hmac(username),
            targetType: 'Cliente',
            targetId: cliente.id,
            outcome: 'success'
        });

        return res.json({
            sucesso: true,
            perfil: 'Cliente',
            usuario: usuarioPublico({
                role: 'DevViewer',
                documento: cliente.cnpj,
                airtableId: cliente.id,
                email: null,
                nomeEmpresa: cliente.idCliente || cliente.nome || null
            }),
            csrfToken: sessao.csrfToken,
            redirectTo: '/portal.html'
        });
    } catch (error) {
        console.error(`[${req.requestId}] [DEV_VIEWER_LOGIN]`, error.message);
        return erro(res, 503, 'Não foi possível abrir a visualização do cliente agora.', 'DEV_VIEWER_UNAVAILABLE');
    }
});

// Contrato único de acesso gerado. Endpoints de senha pessoal estão aposentados.
app.post('/api/login', sameOriginOnly, async (req, res, next) => {
    if (config.clientAuth.mode !== 'generated') return next();
    const documento = limparDocumento(req.body?.documento);
    const senha = String(req.body?.senha ?? req.body?.password ?? '');
    try {
        const cheap = loginBurstGuard.consume(req.ip || 'unknown');
        if (!cheap.ok) { retryAfter(res, cheap); return erro(res, 429, 'Muitas tentativas. Aguarde.', 'RATE_LIMITED'); }
        const rl = await consumirLimitesCliente(req, documento || 'invalid');
        if (!rl.ok) { retryAfter(res, rl); return erro(res, 429, 'Muitas tentativas. Aguarde alguns minutos.', 'RATE_LIMITED'); }
        const cliente = documento.length === 14 && senha.length <= 128 ? await buscarIdentidadeAcesso(documento) : null;
        if (!cliente || !safeEqualHex(sha256(senha), sha256(cliente.accessPassword))) {
            await defensiveDelay();
            await audit(req, 'client_login', { actorType: 'Cliente', actorId: hmac(documento), outcome: 'denied' });
            return erro(res, 401, 'CNPJ ou senha inválidos.', 'INVALID_CREDENTIALS');
        }
        if (req.session) await destroySession(req, res);
        const sessao = await createSession(req, res, { role: 'GeneratedClient', airtableId: cliente.id,
            documento, email: cliente.emailLogin, nomeEmpresa: cliente.idCliente || cliente.nome },
            { remember: req.body?.remember === true });
        await Promise.allSettled([reset('client-login-account', documento), registrarUltimoAcesso(cliente),
            audit(req, 'client_login', { actorType: 'Cliente', actorId: hmac(documento), outcome: 'success_generated' })]);
        return res.json({ sucesso: true, perfil: 'Cliente', csrfToken: sessao.csrfToken, redirectTo: '/portal.html' });
    } catch (error) {
        console.error(`[${req.requestId}] [GENERATED_LOGIN]`, error.code || 'dependency_unavailable');
        return erro(res, 503, 'Não foi possível concluir o acesso. Entre em contato com a ITR se o problema persistir.', 'LOGIN_UNAVAILABLE');
    }
});
app.post('/api/auth/password-reset/request', sameOriginOnly, async (req, res, next) => {
    if (config.clientAuth.mode !== 'generated') return next();
    const documento = limparDocumento(req.body?.documento);
    try {
        const rl = await consumirLimitesRecuperacao(req, documento || 'invalid');
        if (!rl.ok) { retryAfter(res, rl); return erro(res, 429, 'Muitas solicitações. Aguarde alguns minutos.', 'RATE_LIMITED'); }
        const cliente = documento.length === 14 ? await buscarIdentidadeAcesso(documento) : null;
        // Contatos são obtidos no servidor. E-mail fornecido no body nunca é destino.
        if (cliente?.emails?.length) {
            await sendSecurityNotification('ACCESS_REQUEST', { client: cliente });
            await audit(req, 'client_access_request', { actorType: 'Cliente', actorId: hmac(documento), outcome: 'sent' });
        }
        await defensiveDelay();
        return respostaRecuperacaoGenerica(res);
    } catch (error) {
        console.error(`[${req.requestId}] [ACCESS_REQUEST]`, error.code || 'notification_unavailable');
        await audit(req, 'client_access_request', { actorType: 'Cliente', actorId: hmac(documento), outcome: 'error' });
        // Mesma resposta também em falhas, sem revelar cadastro ou destinatários.
        return respostaRecuperacaoGenerica(res);
    }
});

// ---------- Login do cliente ----------
// Migração segura: com CLIENT_PASSWORDS_ENABLED=false, preserva CNPJ + e-mail.
// Quando habilitado, clientes sem senha usam o e-mail apenas como credencial
// inicial para receber um link de ativação. Depois, o login é CNPJ + senha.
app.post('/api/login', sameOriginOnly, async (req, res) => {
    const cheapRl = loginBurstGuard.consume(req.ip || 'unknown');
    if (!cheapRl.ok) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(cheapRl.retryAfterMs / 1000))));
        return erro(res, 429, 'Muitas tentativas de acesso. Aguarde alguns instantes.', 'RATE_LIMITED');
    }
    const documento = limparDocumento(req.body?.documento);
    const segredo = senhaInformada(req);
    const remember = Boolean(req.body?.remember || req.body?.lembrar);

    if (documento.length !== 14 || segredo.length < 5 || segredo.length > 256) {
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
        if (!cliente) {
            await defensiveDelay();
            await audit(req, 'client_login', { actorType: 'Cliente', actorId: hmac(documento), outcome: 'denied' });
            return erro(res, 401, 'Não foi possível validar os dados informados.', 'INVALID_CREDENTIALS');
        }

        // Compatibilidade controlada para implantação gradual da 3.1.0.
        if (!config.clientAuth.enabled) {
            const email = normalizarEmail(segredo);
            const valido = emailValido(email) && (cliente.emails || []).includes(email);
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
                // Limite do IP não é zerado por um login válido.
                registrarUltimoAcesso(cliente),
                audit(req, 'client_login', { actorType: 'Cliente', actorId: hmac(documento), outcome: 'success_legacy' })
            ]);

            return res.json({
                sucesso: true,
                perfil: 'Cliente',
                usuario: usuarioPublico({
                    role: 'Cliente', documento: cliente.cnpj, airtableId: cliente.id,
                    email: cliente.emailLogin, nomeEmpresa: cliente.idCliente || cliente.nome || null
                }),
                csrfToken: sessao.csrfToken,
                redirectTo: '/portal.html'
            });
        }

        const verificacao = await verifyPasswordInScope(cliente.scopeClientIds || [cliente.id], segredo, cliente.id);
        if (verificacao.exists) {
            if (!verificacao.ok) {
                await defensiveDelay();
                await audit(req, 'client_login', { actorType: 'Cliente', actorId: hmac(documento), outcome: 'denied' });
                return erro(res, 401, 'Não foi possível validar os dados informados.', 'INVALID_CREDENTIALS');
            }

            if (req.session) await destroySession(req, res);
            const sessao = await createSession(req, res, {
                role: 'Cliente',
                airtableId: verificacao.accountId || cliente.id,
                documento: cliente.cnpj,
                email: cliente.emailLogin,
                nomeEmpresa: cliente.idCliente || cliente.nome || null
            }, { remember });

            await Promise.allSettled([
                reset('client-login-account', documento),
                // Limite do IP não é zerado por um login válido.
                touchLogin(verificacao.accountId || cliente.id),
                registrarUltimoAcesso(cliente),
                audit(req, 'client_login', { actorType: 'Cliente', actorId: hmac(documento), outcome: 'success' })
            ]);

            return res.json({
                sucesso: true,
                perfil: 'Cliente',
                usuario: usuarioPublico({
                    role: 'Cliente', documento: cliente.cnpj, airtableId: verificacao.accountId || cliente.id,
                    email: cliente.emailLogin, nomeEmpresa: cliente.idCliente || cliente.nome || null
                }),
                csrfToken: sessao.csrfToken,
                redirectTo: '/portal.html'
            });
        }

        // Primeiro acesso: o e-mail é apenas a credencial inicial. O acesso ao
        // Portal só é liberado depois que o dono do e-mail abre o link recebido.
        const emailInicial = normalizarEmail(segredo);
        const emailConfere = emailValido(emailInicial)
            && (cliente.emails || []).includes(emailInicial);
        if (!emailConfere) {
            await defensiveDelay();
            await audit(req, 'client_login', { actorType: 'Cliente', actorId: hmac(documento), outcome: 'denied' });
            return erro(res, 401, 'Não foi possível validar os dados informados.', 'INVALID_CREDENTIALS');
        }

        const ativacaoRl = await consumirLimitesRecuperacao(req, documento);
        if (!ativacaoRl.ok) {
            retryAfter(res, ativacaoRl);
            return erro(res, 429, 'Muitas solicitações. Aguarde alguns minutos e tente novamente.', 'RATE_LIMITED');
        }

        if (req.session) await destroySession(req, res);
        const token = await createPasswordToken({ airtableId: cliente.id, purpose: PURPOSE_ACTIVATE, req });
        const clienteNotificacao = { ...cliente, emailLogin: emailInicial };
        const actionUrl = `${config.publicOrigin}/criar-senha.html#token=${encodeURIComponent(token.raw)}`;

        try {
            await sendSecurityNotification('FIRST_ACCESS', { client: clienteNotificacao, actionUrl });
        } catch (notifyError) {
            console.error(`[${req.requestId}] [FIRST_ACCESS_NOTIFY]`, notifyError.message);
            await audit(req, 'client_first_access', {
                actorType: 'Cliente', actorId: hmac(documento), outcome: 'notification_error'
            });
            return erro(res, 503, 'Não foi possível enviar o link de primeiro acesso agora. Tente novamente em instantes.', 'NOTIFICATION_UNAVAILABLE');
        }

        await audit(req, 'client_first_access', {
            actorType: 'Cliente', actorId: hmac(documento), outcome: 'link_sent'
        });
        return res.status(202).json({
            sucesso: true,
            primeiroAcesso: true,
            mensagem: 'Primeiro acesso identificado. Enviamos um link ao e-mail cadastrado para você criar sua senha pessoal.'
        });
    } catch (error) {
        console.error(`[${req.requestId}] [LOGIN_CLIENTE]`, error.message);
        return erro(res, 503, 'Não foi possível concluir o acesso agora. Tente novamente em instantes.', 'LOGIN_UNAVAILABLE');
    }
});

// ---------- Recuperação / ativação de senha do cliente ----------
app.post('/api/auth/password-reset/request', sameOriginOnly, senhasClientesHabilitadas, async (req, res) => {
    const documento = limparDocumento(req.body?.documento);
    const email = normalizarEmail(req.body?.email);

    try {
        const rl = await consumirLimitesRecuperacao(req, documento || 'invalid');
        if (!rl.ok) {
            retryAfter(res, rl);
            return erro(res, 429, 'Muitas solicitações. Aguarde alguns minutos e tente novamente.', 'RATE_LIMITED');
        }

        // Resposta externa é deliberadamente igual para cadastro inexistente,
        // e-mail divergente e conta válida: evita enumeração de clientes.
        if (documento.length !== 14 || !emailValido(email)) {
            await defensiveDelay();
            return respostaRecuperacaoGenerica(res);
        }

        const cliente = await buscarClientePorCnpj(documento);
        const corresponde = cliente && (cliente.emails || []).includes(email);
        if (!corresponde) {
            await defensiveDelay();
            await audit(req, 'client_password_request', { actorType: 'Cliente', actorId: hmac(documento), outcome: 'ignored' });
            return respostaRecuperacaoGenerica(res);
        }

        const account = await findScopeAccount(cliente.scopeClientIds || [cliente.id], cliente.id);
        const accountId = account?.airtable_client_id || cliente.id;
        const purpose = account ? PURPOSE_RESET : PURPOSE_ACTIVATE;
        const token = await createPasswordToken({ airtableId: accountId, purpose, req });
        const clienteNotificacao = { ...cliente, id: accountId, emailLogin: email };
        const tipo = account ? 'PASSWORD_RESET' : 'FIRST_ACCESS';
        const actionUrl = account
            ? `${config.publicOrigin}/redefinir-senha.html#token=${encodeURIComponent(token.raw)}`
            : `${config.publicOrigin}/criar-senha.html#token=${encodeURIComponent(token.raw)}`;

        // O envio é disparado depois da resposta para que tempo de SMTP não revele
        // se o CNPJ/e-mail corresponde a uma conta existente (anti-enumeração).
        const requestId = req.requestId;
        setImmediate(() => {
            sendSecurityNotification(tipo, { client: clienteNotificacao, actionUrl })
                .then(() => {
                    console.info(`[${requestId}] [PASSWORD_NOTIFY] Serviço de notificações confirmou o processamento (${tipo}).`);
                    return audit(req, 'client_password_request', {
                        actorType: 'Cliente', actorId: hmac(documento), outcome: account ? 'reset_sent' : 'activation_sent'
                    });
                })
                .catch(async notifyError => {
                    console.error(`[${requestId}] [PASSWORD_NOTIFY]`, notifyError.message);
                    try {
                        await audit(req, 'client_password_request', {
                            actorType: 'Cliente', actorId: hmac(documento), outcome: 'notification_error'
                        });
                    } catch (_) {}
                });
        });
        await defensiveDelay();
        return respostaRecuperacaoGenerica(res);
    } catch (error) {
        console.error(`[${req.requestId}] [PASSWORD_REQUEST]`, error.message);
        // Também não diferenciamos indisponibilidade interna de cadastro inexistente.
        return respostaRecuperacaoGenerica(res);
    }
});

app.post('/api/auth/password/activate', sameOriginOnly, senhasClientesHabilitadas, async (req, res) => {
    const tokenRaw = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    const confirmation = String(req.body?.confirmation || '');
    if (!tokenRaw || password !== confirmation) {
        return erro(res, 400, 'Confira a nova senha e a confirmação.', 'INVALID_REQUEST');
    }

    try {
        const rl = await consumirLimiteConfirmacaoSenha(req);
        if (!rl.ok) {
            retryAfter(res, rl);
            return erro(res, 429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.', 'RATE_LIMITED');
        }
        const token = await peekPasswordToken(tokenRaw);
        if (!token || token.purpose !== PURPOSE_ACTIVATE) {
            return erro(res, 400, 'Este link de primeiro acesso é inválido ou expirou.', 'TOKEN_INVALID');
        }
        const clienteEscopo = await buscarClientePorId(token.airtable_client_id);
        if (!clienteEscopo?.emailLogin) return erro(res, 400, 'Este link de primeiro acesso não pode mais ser utilizado.', 'TOKEN_INVALID');
        const cliente = { ...clienteEscopo, id: token.airtable_client_id };

        await activateAccount(tokenRaw, password, cliente);
        if (req.session) await destroySession(req, res);
        const sessao = await createSession(req, res, {
            role: 'Cliente', airtableId: token.airtable_client_id, documento: cliente.cnpj,
            email: cliente.emailLogin, nomeEmpresa: cliente.idCliente || cliente.nome || null
        });
        await Promise.allSettled([
            registrarUltimoAcesso(cliente),
            audit(req, 'client_password_created', { actorType: 'Cliente', actorId: hmac(cliente.cnpj), outcome: 'success' }),
            sendSecurityNotification('PASSWORD_CREATED', { client: cliente })
        ]);
        return res.json({
            sucesso: true,
            mensagem: 'Senha criada com sucesso.',
            csrfToken: sessao.csrfToken,
            redirectTo: '/portal.html'
        });
    } catch (error) {
        console.error(`[${req.requestId}] [PASSWORD_ACTIVATE]`, error.message);
        if (['WEAK_PASSWORD', 'ACCOUNT_EXISTS', 'TOKEN_INVALID'].includes(error.code)) {
            return erro(res, 400, error.message, error.code);
        }
        return erro(res, 503, 'Não foi possível concluir a criação da senha agora.', 'PASSWORD_UNAVAILABLE');
    }
});

app.post('/api/auth/password/reset', sameOriginOnly, senhasClientesHabilitadas, async (req, res) => {
    const tokenRaw = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    const confirmation = String(req.body?.confirmation || '');
    if (!tokenRaw || password !== confirmation) {
        return erro(res, 400, 'Confira a nova senha e a confirmação.', 'INVALID_REQUEST');
    }

    try {
        const rl = await consumirLimiteConfirmacaoSenha(req);
        if (!rl.ok) {
            retryAfter(res, rl);
            return erro(res, 429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.', 'RATE_LIMITED');
        }
        const token = await peekPasswordToken(tokenRaw);
        if (!token || token.purpose !== PURPOSE_RESET) {
            return erro(res, 400, 'Este link de recuperação é inválido ou expirou.', 'TOKEN_INVALID');
        }
        const clienteEscopo = await buscarClientePorId(token.airtable_client_id);
        if (!clienteEscopo?.emailLogin) return erro(res, 400, 'Este link de recuperação não pode mais ser utilizado.', 'TOKEN_INVALID');
        const cliente = { ...clienteEscopo, id: token.airtable_client_id };

        await resetPasswordWithToken(tokenRaw, password, cliente);
        const sessao = await createSession(req, res, {
            role: 'Cliente', airtableId: token.airtable_client_id, documento: cliente.cnpj,
            email: cliente.emailLogin, nomeEmpresa: cliente.idCliente || cliente.nome || null
        });
        await Promise.allSettled([
            registrarUltimoAcesso(cliente),
            audit(req, 'client_password_reset', { actorType: 'Cliente', actorId: hmac(cliente.cnpj), outcome: 'success' }),
            sendSecurityNotification('PASSWORD_CHANGED', { client: cliente })
        ]);
        return res.json({
            sucesso: true,
            mensagem: 'Senha redefinida com sucesso.',
            csrfToken: sessao.csrfToken,
            redirectTo: '/portal.html'
        });
    } catch (error) {
        console.error(`[${req.requestId}] [PASSWORD_RESET]`, error.message);
        if (['WEAK_PASSWORD', 'ACCOUNT_MISSING', 'TOKEN_INVALID'].includes(error.code)) {
            return erro(res, 400, error.message, error.code);
        }
        return erro(res, 503, 'Não foi possível redefinir a senha agora.', 'PASSWORD_UNAVAILABLE');
    }
});

app.post('/api/auth/password/change', sameOriginOnly, autenticado, somenteCliente, senhasClientesHabilitadas, csrfProtegido, async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const confirmation = String(req.body?.confirmation || '');
    if (!currentPassword || newPassword !== confirmation) {
        return erro(res, 400, 'Confira a senha atual, a nova senha e a confirmação.', 'INVALID_REQUEST');
    }

    try {
        const cliente = await buscarClientePorId(req.session.airtableId);
        if (!cliente) return erro(res, 403, 'Sua conta não possui vínculo de cliente válido.', 'CLIENT_REQUIRED');
        const remember = Boolean(req.session.remember);
        await changePassword({
            airtableId: req.session.airtableId,
            currentPassword,
            newPassword,
            client: cliente
        });
        const sessao = await createSession(req, res, {
            role: 'Cliente', airtableId: req.session.airtableId, documento: cliente.cnpj,
            email: cliente.emailLogin, nomeEmpresa: cliente.idCliente || cliente.nome || null
        }, { remember });
        await Promise.allSettled([
            audit(req, 'client_password_changed', { actorType: 'Cliente', actorId: hmac(cliente.cnpj), outcome: 'success' }),
            sendSecurityNotification('PASSWORD_CHANGED', { client: cliente })
        ]);
        return res.json({ sucesso: true, mensagem: 'Sua senha foi alterada.', csrfToken: sessao.csrfToken });
    } catch (error) {
        console.error(`[${req.requestId}] [PASSWORD_CHANGE]`, error.message);
        if (['WEAK_PASSWORD', 'CURRENT_PASSWORD_INVALID', 'PASSWORD_REUSED', 'ACCOUNT_MISSING'].includes(error.code)) {
            return erro(res, 400, error.message, error.code);
        }
        return erro(res, 503, 'Não foi possível alterar sua senha agora.', 'PASSWORD_UNAVAILABLE');
    }
});

app.post('/api/onboarding', sameOriginOnly, autenticado, somenteCliente, senhasClientesHabilitadas, csrfProtegido, async (req, res) => {
    const action = String(req.body?.action || '');
    if (!['completed', 'dismissed'].includes(action)) {
        return erro(res, 400, 'Estado de tutorial inválido.', 'INVALID_REQUEST');
    }
    try {
        await markOnboarding(req.session.airtableId, action);
        await audit(req, 'client_onboarding', {
            actorType: 'Cliente', actorId: hmac(req.session.documento || req.session.airtableId), outcome: action
        });
        return res.json({ sucesso: true, onboardingVersion: config.clientAuth.onboardingVersion });
    } catch (error) {
        console.error(`[${req.requestId}] [ONBOARDING]`, error.message);
        return erro(res, 503, 'Não foi possível salvar sua preferência de tutorial agora.', 'ONBOARDING_UNAVAILABLE');
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
app.get('/api/conta', autenticado, async (req, res) => {
    if (!['GeneratedClient', 'DevViewer'].includes(req.session.role)) {
        return erro(res, 403, 'Esta consulta está disponível na conta do cliente.');
    }
    try {
        const conta = await buscarContatosConta(req.session.documento, req.session.airtableId);
        if (!conta) return erro(res, 404, 'Não foi possível localizar os contatos desta conta.');
        return res.json({ sucesso: true, conta });
    } catch (error) {
        console.error(`[${req.requestId}] [CONTA]`, error.code || 'dependency_unavailable');
        return erro(res, 503, 'Não foi possível carregar os contatos agora. Tente novamente.');
    }
});

app.get('/api/perfil', autenticado, async (req, res) => {
    try {
        return res.json({ sucesso: true, usuario: await usuarioPublicoComEstado(req.session) });
    } catch (error) {
        console.error(`[${req.requestId}] [PERFIL]`, error.message);
        return erro(res, 503, 'Não foi possível carregar os dados da sua sessão agora.', 'PROFILE_UNAVAILABLE');
    }
});

// Navegação é apenas apresentação; cada endpoint mantém sua autorização.
app.get('/api/navegacao', autenticado, somenteClientePortal, async (req, res) => {
    try {
        const [relatorios, resultado] = await Promise.all([
            temTrabalhosAutorizados(req.session.airtableId),
            financeiroHabilitado() ? listarPropostasPorCnpj(req.session.documento) : { propostas: [] }
        ]);
        return res.json({
            sucesso: true,
            relatorios,
            propostas: resultado.propostas.length > 0,
            financeiro: financeiroVisivel(req.session, resultado.propostas)
        });
    } catch (_) {
        return erro(res, 503, 'Não foi possível verificar as funcionalidades disponíveis. Tente novamente.', 'NAVIGATION_UNAVAILABLE');
    }
});

// ---------- Propostas (base financeira isolada) ----------
app.get('/api/propostas', autenticado, somenteClientePortal, async (req, res) => {
    if (!financeiroHabilitado()) {
        return erro(res, 503, 'A integração de propostas ainda não está configurada neste ambiente.', 'FINANCE_NOT_CONFIGURED');
    }
    try {
        const resultado = await listarPropostasPorCnpj(req.session.documento);
        return res.json({
            sucesso: true,
            clienteEncontrado: Boolean(resultado.cliente),
            propostas: resultado.propostas
        });
    } catch (error) {
        console.error(`[${req.requestId}] [PROPOSTAS]`, error.code || error.message);
        return erro(res, 503, 'Não foi possível carregar suas propostas agora. Tente novamente.', 'PROPOSALS_UNAVAILABLE');
    }
});

// A rota antiga não pode conservar um caminho alternativo de aceite imediato.
app.post('/api/propostas/:id/aceitar', sameOriginOnly, autenticado, somenteClientePortal, csrfProtegido, escritaHabilitada, (req, res) => {
    return erro(res, 410, 'Solicite o código de confirmação no Portal.', 'CONFIRMATION_REQUIRED');
});

const proposalsWorker = require('./lib/proposals').install(app, {
    pool, config, auth: autenticado, client: somenteClientePortal,
    csrf: csrfProtegido, origin: sameOriginOnly, write: escritaHabilitada,
    consume, audit
});

app.get('/api/propostas/:id/documento/:anexoId', autenticado, somenteClientePortal, async (req, res) => {
    try {
        const limit = await consume('proposal-pdf', req.ip + ':' + req.session.documento, { limit: 30, windowMs: 60000 });
        if (!limit.ok) {
            retryAfter(res, limit);
            return erro(res, 429, 'Aguarde antes de abrir mais documentos.', 'RATE_LIMITED');
        }
        const doc = await obterDocumentoProposta(req.session.documento, req.params.id, req.params.anexoId);
        if (!doc) return erro(res, 404, 'Documento da proposta não encontrado.', 'PROPOSAL_DOCUMENT_NOT_FOUND');
        const { readPdf, disposition } = require('./lib/proposals/pdf');
        const document = await readPdf(doc.url);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', disposition(doc.nome));
        res.setHeader('Cache-Control', 'no-store');
        res.send(document.bytes);
    } catch (error) {
        console.error(`[${req.requestId}] [PROPOSTA_DOCUMENTO]`, error.code || error.message);
        if (!res.headersSent) return erro(res, 503, 'Não foi possível abrir o documento agora.', 'PROPOSAL_DOCUMENT_UNAVAILABLE');
        res.destroy(error);
    }
});

// ---------- Financeiro: contratos e faturas (somente leitura) ----------
require('./lib/financeiro').install(app, {
    airtable: require('./finance-airtable'),
    auth: autenticado,
    client: somenteClientePortal,
    consume,
    audit,
    hmac
});

// Alias legado: carrega a sessão explicitamente porque está fora do prefixo /api.
app.get('/perfil', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); }, carregarSessao, autenticado, async (req, res) => {
    try {
        return res.json({ sucesso: true, usuario: await usuarioPublicoComEstado(req.session) });
    } catch (error) {
        console.error(`[${req.requestId}] [PERFIL_ALIAS]`, error.message);
        return erro(res, 503, 'Não foi possível carregar os dados da sua sessão agora.', 'PROFILE_UNAVAILABLE');
    }
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

app.post('/api/logout', sameOriginOnly, (req, res, next) => req.session ? csrfProtegido(req, res, next) : next(), async (req, res) => {
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
    const clientId = req.session.role !== 'Director' ? req.session.airtableId : null;
    const arquivoId = req.query.arquivo;
    if (arquivoId !== undefined && (typeof arquivoId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(arquivoId))) return null;
    return urlRelatorioAprovado(id, clientId, arquivoId == null ? null : arquivoId);
}

app.get('/api/trabalho/:id/download', autenticado, async (req, res) => {
    try {
        const id = req.params.id;
        if (!recordIdValido(id)) return erro(res, 404, 'Este relatório não está disponível para download.');
        const clientId = req.session.role !== 'Director' ? req.session.airtableId : null;
        const pdfs = await relatoriosAprovados(id, clientId);
        if (!pdfs?.length) return erro(res, 404, 'Este relatório não está disponível para download.');
        const arquivos = pdfs.map(pdf => ({ arquivo: pdf.nome, url: `/api/relatorio/${encodeURIComponent(id)}?arquivo=${encodeURIComponent(pdf.id)}` }));
        return res.json({ sucesso: true, arquivo: arquivos[0].arquivo, url: arquivos[0].url, arquivos });
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
                registrarDownload(['Cliente', 'GeneratedClient'].includes(req.session.role) ? req.session.documento : null, req.params.id),
                audit(req, 'report_download', {
                    actorType: req.session.role,
                    actorId: req.session.role !== 'Director' ? hmac(req.session.documento) : 'diretor',
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
        const resumo = req.query.resumo === '1';
        const cnpj = String(req.query.cnpj || '');
        if (resumo && !/^\d{14}$/.test(cnpj)) return erro(res, 400, 'CNPJ inválido.');
        const [linhas] = await pool.query(
            `SELECT cnpj, record_id_trabalho, baixado_em FROM relatorios_baixados
             ${resumo ? 'WHERE cnpj = ?' : ''} ORDER BY baixado_em DESC LIMIT ?`,
            resumo ? [cnpj, limite] : [limite]
        );
        // O selo no cartão só precisa do histórico MySQL; não consulta Airtable.
        if (resumo) return res.json({ sucesso: true, downloads: linhas.map(linha => ({
            cnpj: linha.cnpj, record_id: linha.record_id_trabalho, baixado_em: linha.baixado_em
        })) });

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
    proposalsWorker.start();
    server = app.listen(config.port, () => {
        console.log('===================================================');
        console.log(` Portal ITR: http://localhost:${config.port}`);
        console.log(` Ambiente: ${config.nodeEnv}`);
        console.log(` Notificações: ${config.notifications.url || "não configurado"}`);
        console.log(` Modo seguro: ${config.security.safeMode || !config.security.writeEnabled ? 'ATIVO' : 'desativado'}`);
        console.log('===================================================');
    });
    // Hardening contra slowloris/conexoes presas. Valores conservadores para Render.
    server.headersTimeout = 15000;
    server.requestTimeout = 30000;
    server.keepAliveTimeout = 5000;
    server.maxRequestsPerSocket = 1000;
    setImmediate(() => carregarScopeSnapshot().catch(error => {
        console.warn('[AIRTABLE_SCOPE] prewarm falhou:', error.message);
    }));
}

async function shutdown(signal) {
    console.log(`[SHUTDOWN] ${signal}: encerrando conexões...`);
    await proposalsWorker.stop();
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
