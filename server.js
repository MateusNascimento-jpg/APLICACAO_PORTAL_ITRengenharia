const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

const pool = require('./db');
const {
    buscarTrabalhosDoCliente,
    buscarClientePorCnpj,
    urlRelatorioAprovado,
    listarClientes,
    definirAprovacao,
    APROVACAO_VALIDAS
} = require('./airtable');
const { enviarEmailReset } = require('./email');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'chave_secreta_padrao';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const MAX_TENTATIVAS_LOGIN = Number(process.env.MAX_TENTATIVAS_LOGIN || 5);
const MINUTOS_BLOQUEIO_LOGIN = Number(process.env.MINUTOS_BLOQUEIO_LOGIN || 15);

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
        email: usuario.email || null
    };
}

async function registrarHistoricoLogin(req, usuarioId, sucesso, motivoFalha = null) {
    try {
        await pool.query(
            `INSERT INTO historico_logins (usuario_id, sucesso, ip_origem, navegador, motivo_falha)
             VALUES (?, ?, ?, ?, ?)`,
            [usuarioId || null, !!sucesso, getIp(req), String(req.headers['user-agent'] || '').slice(0, 255), motivoFalha]
        );
    } catch (err) {
        console.warn('[HISTORICO_LOGIN] Não foi possível registrar tentativa:', err.message);
    }
}

async function registrarDownload(usuarioId, recordIdTrabalho) {
    try {
        await pool.query(
            `INSERT IGNORE INTO relatorios_baixados (usuario_id, record_id_trabalho)
             VALUES (?, ?)`,
            [usuarioId, recordIdTrabalho]
        );
    } catch (err) {
        console.warn('[DOWNLOAD] Não foi possível registrar download:', err.message);
    }
}

function criarToken(usuario) {
    return jwt.sign(
        { id: usuario.id, perfil: usuario.perfil, airtableId: usuario.airtable_client_id || null },
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

// ==================== CADASTRO PÚBLICO ====================
// Apenas CNPJ pré-autorizado no Airtable pode criar conta de Cliente.
app.post(['/api/cadastro', '/cadastro'], async (req, res) => {
    try {
        const documento = limparDocumento(req.body.documento);
        const email = normalizarEmail(req.body.email);
        const senha = String(req.body.senha || '');

        if (documento.length !== 14) {
            return erro(res, 400, 'O cadastro público só é permitido para CNPJ com 14 dígitos.');
        }
        if (!emailValido(email)) {
            return erro(res, 400, 'Informe um e-mail válido.');
        }
        if (senha.length < 8) {
            return erro(res, 400, 'A senha deve ter no mínimo 8 caracteres.');
        }

        const clienteAirtable = await buscarClientePorCnpj(documento);
        if (!clienteAirtable) {
            return erro(res, 403, 'Este CNPJ não foi pré-autorizado pela ITR Engenharia no Airtable. Entre em contato com o suporte.');
        }

        const [existente] = await pool.query(
            `SELECT id, status_conta FROM usuarios_cnpj
             WHERE documento = ? OR email = ?
             LIMIT 1`,
            [documento, email]
        );
        if (existente.length > 0) {
            return erro(res, 409, 'Este CNPJ ou e-mail já possui uma conta criada.');
        }

        const senhaHash = await bcrypt.hash(senha, 10);
        await pool.query(
            `INSERT INTO usuarios_cnpj
                (documento, tipo_documento, email, senha_hash, nome_empresa, perfil, airtable_client_id, status_conta)
             VALUES
                (?, 'CNPJ', ?, ?, ?, 'Cliente', ?, 'Ativo')`,
            [documento, email, senhaHash, clienteAirtable.nome || clienteAirtable.idCliente || null, clienteAirtable.id]
        );

        return res.json({ sucesso: true, mensagem: 'Conta criada com sucesso! Você já pode fazer login.' });
    } catch (error) {
        if (error && error.code === 'ER_DUP_ENTRY') {
            return erro(res, 409, 'Este CNPJ ou e-mail já possui uma conta criada.');
        }
        console.error('[CADASTRO]', error);
        return erro(res, 500, error.message || 'Erro interno ao criar conta.');
    }
});
// ==================== LOGIN ====================
app.post('/api/login', async (req, res) => {
    const documento = limparDocumento(req.body.documento);
    const senha = String(req.body.senha || '');

    try {
        if (!documento || !senha) {
            return erro(res, 400, 'Documento e senha são obrigatórios.');
        }

        const [usuarios] = await pool.query(
            `SELECT id, documento, tipo_documento, email, senha_hash, perfil, airtable_client_id,
                    status_conta, tentativas_login, bloqueado_ate
             FROM usuarios_cnpj
             WHERE documento = ? AND data_exclusao IS NULL
             LIMIT 1`,
            [documento]
        );

        if (usuarios.length === 0) {
            await registrarHistoricoLogin(req, null, false, 'USUARIO_NAO_ENCONTRADO');
            return erro(res, 401, 'Documento ou senha inválidos.');
        }

        const usuario = usuarios[0];
        const bloqueadoAte = usuario.bloqueado_ate ? new Date(usuario.bloqueado_ate) : null;
        if (usuario.status_conta !== 'Ativo') {
            await registrarHistoricoLogin(req, usuario.id, false, 'CONTA_INATIVA_OU_BLOQUEADA');
            return erro(res, 403, 'Esta conta está inativa ou bloqueada. Entre em contato com a ITR Engenharia.');
        }
        if (bloqueadoAte && bloqueadoAte > new Date()) {
            await registrarHistoricoLogin(req, usuario.id, false, 'BLOQUEIO_TEMPORARIO');
            return erro(res, 423, `Muitas tentativas incorretas. Tente novamente após ${bloqueadoAte.toLocaleString('pt-BR')}.`);
        }

        const senhaCorreta = await bcrypt.compare(senha, usuario.senha_hash);
        if (!senhaCorreta) {
            const tentativas = Number(usuario.tentativas_login || 0) + 1;
            if (tentativas >= MAX_TENTATIVAS_LOGIN) {
                await pool.query(
                    `UPDATE usuarios_cnpj
                     SET tentativas_login = ?, bloqueado_ate = DATE_ADD(NOW(), INTERVAL ? MINUTE)
                     WHERE id = ?`,
                    [tentativas, MINUTOS_BLOQUEIO_LOGIN, usuario.id]
                );
                await registrarHistoricoLogin(req, usuario.id, false, 'SENHA_INVALIDA_BLOQUEIO');
                return erro(res, 423, `Muitas tentativas incorretas. A conta foi bloqueada temporariamente por ${MINUTOS_BLOQUEIO_LOGIN} minutos.`);
            }

            await pool.query(`UPDATE usuarios_cnpj SET tentativas_login = ? WHERE id = ?`, [tentativas, usuario.id]);
            await registrarHistoricoLogin(req, usuario.id, false, 'SENHA_INVALIDA');
            return erro(res, 401, 'Documento ou senha inválidos.');
        }

        await pool.query(
            `UPDATE usuarios_cnpj
             SET ultimo_login = NOW(), tentativas_login = 0, bloqueado_ate = NULL
             WHERE id = ?`,
            [usuario.id]
        );
        await registrarHistoricoLogin(req, usuario.id, true, null);

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

    await registrarDownload(req.usuario.id, recordIdTrabalho);
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
app.post('/api/esqueci-senha', async (req, res) => {
    try {
        const email = normalizarEmail(req.body.email);
        if (!emailValido(email)) {
            return erro(res, 400, 'Por favor, informe um e-mail válido.');
        }

        const [usuarios] = await pool.query(
            `SELECT id, email, perfil FROM usuarios_cnpj
             WHERE email = ? AND status_conta = 'Ativo' AND data_exclusao IS NULL
             LIMIT 1`,
            [email]
        );

        if (usuarios.length > 0) {
            const usuario = usuarios[0];
            const token = crypto.randomBytes(32).toString('hex');
            await pool.query(
                `UPDATE usuarios_cnpj
                 SET reset_token = ?, reset_expires = DATE_ADD(NOW(), INTERVAL 1 HOUR)
                 WHERE id = ?`,
                [token, usuario.id]
            );

            const urlBase = process.env.APP_URL || 'http://localhost:3000';
            const linkReset = `${urlBase}/redefinir-senha.html?token=${encodeURIComponent(token)}`;
            const destino = process.env.RESET_EMAIL_OVERRIDE || usuario.email;
            enviarEmailReset(destino, linkReset, usuario.perfil || 'Cliente')
                .catch(err => console.error('[RESET_EMAIL]', err.message));
        }

        return res.json({
            sucesso: true,
            mensagem: 'Se o e-mail informado estiver cadastrado, você receberá um link para redefinir sua senha em instantes.'
        });
    } catch (error) {
        console.error('[ESQUECI_SENHA]', error);
        return erro(res, 500, 'Erro interno ao processar o pedido de recuperação.');
    }
});

app.post('/api/redefinir-senha', async (req, res) => {
    try {
        const token = String(req.body.token || '').trim();
        const senha = String(req.body.senha || '');

        if (!token) return erro(res, 400, 'Token de recuperação ausente ou inválido.');
        if (senha.length < 8) return erro(res, 400, 'A nova senha deve ter no mínimo 8 caracteres.');

        const [usuarios] = await pool.query(
            `SELECT id FROM usuarios_cnpj
             WHERE reset_token = ? AND reset_expires > NOW()
             AND status_conta = 'Ativo' AND data_exclusao IS NULL
             LIMIT 1`,
            [token]
        );

        if (usuarios.length === 0) {
            return erro(res, 400, 'O link de recuperação é inválido ou já expirou. Solicite um novo.');
        }

        const novaSenhaHash = await bcrypt.hash(senha, 10);
        await pool.query(
            `UPDATE usuarios_cnpj
             SET senha_hash = ?, reset_token = NULL, reset_expires = NULL, tentativas_login = 0, bloqueado_ate = NULL
             WHERE id = ?`,
            [novaSenhaHash, usuarios[0].id]
        );

        return res.json({ sucesso: true, mensagem: 'Senha redefinida com sucesso. Você já pode fazer login.' });
    } catch (error) {
        console.error('[REDEFINIR_SENHA]', error);
        return erro(res, 500, 'Erro interno ao processar a redefinição de senha.');
    }
});

app.use('/api', (req, res) => erro(res, 404, 'Rota da API não encontrada.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('===================================================');
    console.log(` SERVIDOR ONLINE: http://localhost:${PORT}`);
    console.log(' Projeto: Portal do Cliente ITR Engenharia');
    console.log('===================================================');
});
