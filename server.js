const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();
// bcrypt, crypto e email(reset) foram removidos junto com o login antigo:
// o modelo novo autentica por CNPJ + e-mail no Airtable (sem senha/hash/reset).

const pool = require('./db');
const {
    buscarTrabalhosDoCliente,
    buscarClientePorCnpj,
    urlRelatorioAprovado,
    listarClientes,
    definirAprovacao,
    APROVACAO_VALIDAS
} = require('./airtable');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'chave_secreta_padrao';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
// Bloqueio por tentativas agora e feito por rate limit de IP (ver /api/login).

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function limparDocumento(doc) {
    return String(doc || '').replace(/\D/g, '');
}

function normalizarEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function emailValido(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function getIp(req) {
    return (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();
}

function usuarioPublico(usuario) {
    return {
        id: usuario.id,
        documento: usuario.documento,
        tipoDocumento: usuario.tipo_documento || (String(usuario.documento || '').length === 11 ? 'CPF' : 'CNPJ'),
        perfil: usuario.perfil,
        airtableId: usuario.airtable_client_id || null,
        email: usuario.email || null,
        nomeEmpresa: usuario.nome_empresa || null
    };
}

async function registrarHistoricoLogin(req, cnpjTentado, sucesso, motivoFalha = null) {
    try {
        await pool.query(
            `INSERT INTO historico_logins (cnpj_tentado, sucesso, ip_origem, navegador, motivo_falha)
             VALUES (?, ?, ?, ?, ?)`,
            [cnpjTentado || null, !!sucesso, getIp(req), String(req.headers['user-agent'] || '').slice(0, 255), motivoFalha]
        );
    } catch (err) {
        console.warn('[HISTORICO_LOGIN] Não foi possível registrar tentativa:', err.message);
    }
}

// Registra o download por CNPJ (login novo nao tem usuario_id do MySQL).
// Mantem o "baixou ou nao": INSERT IGNORE + UNIQUE(cnpj, record) evita duplicar.
async function registrarDownload(cnpj, recordIdTrabalho) {
    if (!cnpj) return; // sem CNPJ nao ha o que rastrear
    try {
        await pool.query(
            `INSERT IGNORE INTO relatorios_baixados (cnpj, record_id_trabalho)
             VALUES (?, ?)`,
            [cnpj, recordIdTrabalho]
        );
    } catch (err) {
        console.warn('[DOWNLOAD] Não foi possível registrar download:', err.message);
    }
}

function criarToken(usuario) {
    return jwt.sign(
        {
            id: usuario.id, // null no login novo (nao ha MySQL de usuarios)
            perfil: usuario.perfil,
            airtableId: usuario.airtable_client_id || null,
            documento: usuario.documento || null // CNPJ: identifica o cliente no tracking
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

function erro(res, status, mensagem) {
    return res.status(status).json({ sucesso: false, erro: mensagem });
}

app.get('/', (req, res) => res.redirect('/login.html'));

app.get('/status', (req, res) => {
    res.json({ status: 'Online', projeto: 'Portal do Cliente ITR Engenharia' });
});

// ==================== CADASTRO: REMOVIDO ====================
// O cadastro publico foi descontinuado. No modelo novo o cliente NAO cria
// conta: ele ja existe no Airtable e entra com CNPJ + e-mail cadastrado.
// As rotas /api/cadastro e /cadastro respondem 410 (Gone) para deixar claro.
app.post(['/api/cadastro', '/cadastro'], (req, res) =>
    erro(res, 410, 'O cadastro não é mais necessário. Acesse com seu CNPJ e o e-mail cadastrado na ITR.')
);

// ==================== LOGIN (CNPJ + E-MAIL do Airtable) ====================
// Modelo novo: NAO ha senha/bcrypt/MySQL para autenticar. O cliente entra com
//   LOGIN = CNPJ  e  SENHA = primeiro e-mail cadastrado no campo "Email Cliente"
//   da tabela Clientes do Airtable (base 1).
// Regra: o CNPJ precisa existir no Airtable E o e-mail digitado precisa bater
// (normalizado: minusculas, sem espaco) com o PRIMEIRO e-mail do cliente.
// Se OK -> gera JWT com o airtableId -> acesso aos relatorios (isolamento por
// CNPJ como ja e). Rate limiting por IP evita varredura de CNPJs publicos.

// Rate limiting simples em memoria (por IP). Sem dependencia externa.
const tentativasPorIp = new Map(); // ip -> { count, primeiraEm }
const RL_JANELA_MS = 15 * 60 * 1000;         // janela de 15 min
const RL_MAX = Number(process.env.LOGIN_MAX_TENTATIVAS_IP || 20); // tentativas/janela

function checarRateLimit(ip) {
    const agora = Date.now();
    const reg = tentativasPorIp.get(ip);
    if (!reg || (agora - reg.primeiraEm) > RL_JANELA_MS) {
        tentativasPorIp.set(ip, { count: 1, primeiraEm: agora });
        return { ok: true };
    }
    reg.count += 1;
    if (reg.count > RL_MAX) {
        return { ok: false, esperaMin: Math.ceil((RL_JANELA_MS - (agora - reg.primeiraEm)) / 60000) };
    }
    return { ok: true };
}

// Limpa registros antigos do rate limit de tempos em tempos (evita crescer sem fim).
setInterval(() => {
    const agora = Date.now();
    for (const [ip, reg] of tentativasPorIp.entries()) {
        if ((agora - reg.primeiraEm) > RL_JANELA_MS) tentativasPorIp.delete(ip);
    }
}, RL_JANELA_MS).unref?.();

app.post('/api/login', async (req, res) => {
    const documento = limparDocumento(req.body.documento);
    // aceita tanto "email" quanto "senha" no corpo (a tela envia o e-mail no
    // campo de acesso; mantemos compatibilidade com o nome antigo "senha").
    const emailDigitado = normalizarEmail(req.body.email || req.body.senha);
    const ip = getIp(req) || 'desconhecido';

    try {
        // 1) Rate limit por IP
        const rl = checarRateLimit(ip);
        if (!rl.ok) {
            await registrarHistoricoLogin(req, documento || null, false, 'RATE_LIMIT_IP');
            return erro(res, 429, `Muitas tentativas. Aguarde ${rl.esperaMin} minuto(s) e tente novamente.`);
        }

        // 2) Validacao de entrada
        if (!documento || !emailDigitado) {
            return erro(res, 400, 'Informe o CNPJ e o e-mail de acesso.');
        }
        if (documento.length !== 14) {
            return erro(res, 400, 'CNPJ inválido. Digite os 14 números do CNPJ de cadastro.');
        }

        // 3) Busca o cliente no Airtable pelo CNPJ
        const cliente = await buscarClientePorCnpj(documento);
        if (!cliente) {
            await registrarHistoricoLogin(req, documento, false, 'CNPJ_NAO_ENCONTRADO');
            return erro(res, 401, 'CNPJ não encontrado. Verifique o número ou entre em contato com a ITR.');
        }

        // 4) O cliente precisa ter e-mail cadastrado no Airtable
        if (!cliente.emailLogin) {
            await registrarHistoricoLogin(req, documento, false, 'CLIENTE_SEM_EMAIL');
            return erro(res, 403, 'Seu acesso ainda não está liberado. Entre em contato com a ITR para cadastrar seu e-mail.');
        }

        // 5) O e-mail digitado precisa bater com o primeiro e-mail do cliente
        if (emailDigitado !== cliente.emailLogin) {
            await registrarHistoricoLogin(req, documento, false, 'EMAIL_INCORRETO');
            return erro(res, 401, 'E-mail de acesso incorreto para este CNPJ.');
        }

        // 6) Tudo certo -> monta um "usuario" so com o necessario para o token.
        //    NAO ha registro no MySQL; o token carrega o airtableId (record do
        //    cliente no Airtable), que e o que o isolamento de relatorios usa.
        const usuario = {
            id: null,                       // sem id do MySQL neste modelo
            documento: cliente.cnpj,
            tipo_documento: 'CNPJ',
            email: cliente.emailLogin,
            perfil: 'Cliente',
            airtable_client_id: cliente.id, // record id do Airtable
            nome_empresa: cliente.idCliente || cliente.nome || null
        };

        await registrarHistoricoLogin(req, documento, true, null);

        // Grava "ultimo acesso" no MySQL (so timestamp + CNPJ), sem travar o login
        // caso a tabela nao exista ainda. Mantem o MySQL util para tracking.
        pool.query(
            `INSERT INTO ultimo_acesso_cliente (cnpj, airtable_client_id, ultimo_acesso)
             VALUES (?, ?, NOW())
             ON DUPLICATE KEY UPDATE ultimo_acesso = NOW(), airtable_client_id = VALUES(airtable_client_id)`,
            [cliente.cnpj, cliente.id]
        ).catch(err => console.warn('[ULTIMO_ACESSO] ignorado:', err.message));

        const token = criarToken(usuario);
        return res.json({
            sucesso: true,
            token,
            perfil: usuario.perfil, // compatibilidade com telas antigas
            usuario: usuarioPublico(usuario),
            mensagem: 'Login realizado com sucesso!'
        });
    } catch (error) {
        console.error('[LOGIN]', error);
        return erro(res, 500, error.message || 'Erro interno ao realizar login.');
    }
});

// ==================== MIDDLEWARES DE PROTEÇÃO ====================
function autenticado(req, res, next) {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const token = authHeader && String(authHeader).startsWith('Bearer ')
        ? String(authHeader).slice(7)
        : null;

    if (!token) return erro(res, 401, 'Token de acesso não fornecido.');

    jwt.verify(token, JWT_SECRET, (err, usuarioDecodificado) => {
        if (err) return erro(res, 403, 'Token inválido ou expirado.');
        req.usuario = usuarioDecodificado;
        next();
    });
}

function somenteDiretor(req, res, next) {
    if (req.usuario.perfil !== 'Diretor') {
        return erro(res, 403, 'Acesso negado. Rota exclusiva para o Diretor.');
    }
    next();
}

app.get(['/api/perfil', '/perfil'], autenticado, (req, res) => {
    res.json({ sucesso: true, usuario: req.usuario });
});

// ==================== PORTAL DO CLIENTE ====================
async function responderTrabalhosCliente(req, res, mesesPadrao) {
    try {
        const recordIdCliente = req.usuario.airtableId;
        if (!recordIdCliente) {
            return erro(res, 400, 'O seu usuário não possui vínculo com cliente no Airtable.');
        }

        const offset = req.query.offset || null;
        const modo = req.query.modo === 'todos' ? 'todos' : 'recente';
        const dados = await buscarTrabalhosDoCliente(recordIdCliente, offset, modo, mesesPadrao);
        return res.json({ sucesso: true, ...dados });
    } catch (error) {
        console.error('[TRABALHOS_CLIENTE]', error);
        return erro(res, 500, error.message || 'Erro ao carregar trabalhos do cliente.');
    }
}

app.get('/api/meus-dados', autenticado, (req, res) => responderTrabalhosCliente(req, res, 3));
app.get('/api/trabalhos', autenticado, (req, res) => responderTrabalhosCliente(req, res, 3));

async function clientePodeAcessarTrabalho(req, recordIdTrabalho) {
    if (req.usuario.perfil === 'Diretor') return true;
    if (!req.usuario.airtableId) return false;

    const dados = await buscarTrabalhosDoCliente(req.usuario.airtableId, null, 'todos', null);
    return (dados.trabalhos || []).some(t => t.id === recordIdTrabalho);
}

async function obterPdfAprovado(req, res) {
    const recordIdTrabalho = req.params.id;

    const permitido = await clientePodeAcessarTrabalho(req, recordIdTrabalho);
    if (!permitido) {
        return { erroStatus: 403, erroMensagem: 'Você não tem permissão para acessar este relatório.' };
    }

    const pdf = await urlRelatorioAprovado(recordIdTrabalho);
    if (!pdf || !pdf.url) {
        return { erroStatus: 404, erroMensagem: 'O arquivo PDF deste relatório não está disponível ou o trabalho ainda não foi aprovado.' };
    }

    await registrarDownload(req.usuario.documento, recordIdTrabalho);
    return pdf;
}

// Retorna JSON com URL fresca do Airtable.
app.get('/api/trabalho/:id/download', autenticado, async (req, res) => {
    try {
        const pdf = await obterPdfAprovado(req, res);
        if (pdf.erroStatus) return erro(res, pdf.erroStatus, pdf.erroMensagem);
        return res.json({ sucesso: true, arquivo: pdf.nome, url: pdf.url });
    } catch (error) {
        console.error('[DOWNLOAD_JSON]', error);
        return erro(res, 500, error.message || 'Erro ao abrir relatório.');
    }
});

// Alias usado pelo portal.html: redireciona diretamente para o PDF.
app.get('/api/relatorio/:id', autenticado, async (req, res) => {
    try {
        const pdf = await obterPdfAprovado(req, res);
        if (pdf.erroStatus) return erro(res, pdf.erroStatus, pdf.erroMensagem);
        return res.redirect(pdf.url);
    } catch (error) {
        console.error('[DOWNLOAD_REDIRECT]', error);
        return erro(res, 500, error.message || 'Erro ao abrir relatório.');
    }
});

// ==================== PAINEL DO DIRETOR ====================
async function responderClientesDiretor(req, res) {
    try {
        const clientes = await listarClientes();
        return res.json({ sucesso: true, clientes });
    } catch (error) {
        console.error('[DIRETOR_CLIENTES]', error);
        return erro(res, 500, error.message || 'Erro ao listar clientes.');
    }
}

app.get('/api/diretor/clientes', autenticado, somenteDiretor, responderClientesDiretor);
app.get('/api/clientes', autenticado, somenteDiretor, responderClientesDiretor);

async function responderTrabalhosDiretor(req, res) {
    try {
        const recordIdCliente = req.params.clienteId || req.params.id;
        const offset = req.query.offset || null;
        const modo = req.query.modo === 'todos' ? 'todos' : 'recente';
        const dados = await buscarTrabalhosDoCliente(recordIdCliente, offset, modo, 6);
        return res.json({ sucesso: true, ...dados });
    } catch (error) {
        console.error('[DIRETOR_TRABALHOS]', error);
        return erro(res, 500, error.message || 'Erro ao carregar trabalhos do cliente.');
    }
}

app.get('/api/diretor/trabalhos/:clienteId', autenticado, somenteDiretor, responderTrabalhosDiretor);
app.get('/api/cliente/:id/trabalhos', autenticado, somenteDiretor, responderTrabalhosDiretor);

app.patch('/api/trabalho/:id/aprovacao', autenticado, somenteDiretor, async (req, res) => {
    try {
        const recordIdTrabalho = req.params.id;
        const valor = String(req.body.valor || '').trim();

        if (!APROVACAO_VALIDAS.includes(valor)) {
            return erro(res, 400, `Valor inválido. Use um de: ${APROVACAO_VALIDAS.join(', ')}.`);
        }

        const resultado = await definirAprovacao(recordIdTrabalho, valor);
        const mensagem = valor === 'Aprovado'
            ? 'Relatório enviado! O cliente já poderá visualizar no portal.'
            : valor === 'Refazer'
                ? 'Relatório marcado para refação.'
                : 'Relatório marcado como em andamento.';

        return res.json({ sucesso: true, mensagem, ...resultado });
    } catch (error) {
        console.error('[APROVACAO]', error);
        return erro(res, 500, error.message || 'Erro ao atualizar aprovação.');
    }
});

// ==================== RECUPERAÇÃO DE SENHA ====================
// ==================== RECUPERAÇÃO DE SENHA: REMOVIDA ====================
// Nao ha mais senha no modelo novo (a credencial e o e-mail cadastrado no
// Airtable, que o cliente sempre sabe). As rotas respondem 410 (Gone).
// Se o cliente nao lembra qual e-mail esta cadastrado, deve falar com a ITR.
app.post('/api/esqueci-senha', (req, res) =>
    erro(res, 410, 'A recuperação de senha não é mais necessária. Acesse com seu CNPJ e o e-mail cadastrado. Em caso de dúvida, fale com a ITR.')
);
app.post('/api/redefinir-senha', (req, res) =>
    erro(res, 410, 'A recuperação de senha foi descontinuada. Acesse com seu CNPJ e o e-mail cadastrado.')
);

app.use('/api', (req, res) => erro(res, 404, 'Rota da API não encontrada.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('===================================================');
    console.log(` SERVIDOR ONLINE: http://localhost:${PORT}`);
    console.log(' Projeto: Portal do Cliente ITR Engenharia');
    console.log('===================================================');
});