const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

function obrigatoria(nome) {
    const valor = String(process.env[nome] || '').trim();
    if (!valor) throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
    return valor;
}

function inteiro(nome, padrao, minimo, maximo) {
    const bruto = process.env[nome];
    if (bruto == null || bruto === '') return padrao;
    const valor = Number(bruto);
    if (!Number.isInteger(valor) || valor < minimo || valor > maximo) {
        throw new Error(`Variável ${nome} inválida. Esperado inteiro entre ${minimo} e ${maximo}.`);
    }
    return valor;
}

function booleano(nome, padrao = false) {
    const bruto = process.env[nome];
    if (bruto == null || bruto === '') return padrao;
    const valor = String(bruto).trim().toLowerCase();
    if (['1', 'true', 'sim', 'yes', 'on'].includes(valor)) return true;
    if (['0', 'false', 'nao', 'não', 'no', 'off'].includes(valor)) return false;
    throw new Error(`Variável ${nome} inválida. Use true/false.`);
}

function chaveBase64(nome, bytesMinimos = 32) {
    const valor = obrigatoria(nome).replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(valor) || valor.length % 4 !== 0) {
        throw new Error(`${nome} deve estar em Base64 válido.`);
    }
    const buffer = Buffer.from(valor, 'base64');
    if (buffer.length < bytesMinimos || buffer.toString('base64') !== valor) {
        throw new Error(`${nome} deve ser uma chave Base64 com pelo menos ${bytesMinimos} bytes.`);
    }
    return valor;
}

function chaveBase64Opcional(nome, bytesMinimos = 32) {
    const bruto = String(process.env[nome] || '').trim();
    if (!bruto) return '';
    const valor = bruto.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(valor) || valor.length % 4 !== 0) {
        throw new Error(`${nome} deve estar em Base64 válido.`);
    }
    const buffer = Buffer.from(valor, 'base64');
    if (buffer.length < bytesMinimos || buffer.toString('base64') !== valor) {
        throw new Error(`${nome} deve ser uma chave Base64 com pelo menos ${bytesMinimos} bytes.`);
    }
    return valor;
}

function urlOpcional(nome) {
    const bruto = String(process.env[nome] || '').trim().replace(/\/$/, '');
    if (!bruto) return '';
    let parsed;
    try { parsed = new URL(bruto); } catch (_) { throw new Error(`${nome} deve ser uma URL válida.`); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error(`${nome} deve ser uma origem HTTP/HTTPS válida, sem credenciais ou parâmetros.`);
    }
    return bruto;
}

const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
const production = nodeEnv === 'production';
const port = inteiro('PORT', 3000, 1, 65535);
const render = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);

const config = {
    nodeEnv,
    production,
    render,
    port,
    publicOrigin: String(
        process.env.PUBLIC_APP_ORIGIN ||
        (production ? 'https://portal.itr.eng.br' : `http://localhost:${port}`)
    ).replace(/\/$/, ''),

    airtable: {
        token: obrigatoria('AIRTABLE_TOKEN'),
        baseId: obrigatoria('AIRTABLE_BASE_ID'),
        timeoutMs: inteiro('AIRTABLE_TIMEOUT_MS', 12000, 1000, 60000),
        retries: inteiro('AIRTABLE_RETRIES', 3, 0, 6),
        cacheTtlMs: inteiro('AIRTABLE_CACHE_TTL_MS', 300000, 5000, 3600000),
        clientEmailField: String(process.env.AIRTABLE_CLIENT_EMAIL_FIELD || 'Email Cliente').trim(),
        clientWhatsappField: String(process.env.AIRTABLE_CLIENT_WHATSAPP_FIELD || 'WhatsApp do Cliente').trim()
    },

    db: {
        host: obrigatoria('DB_HOST'),
        user: obrigatoria('DB_USER'),
        password: process.env.DB_PASS ?? '',
        database: obrigatoria('DB_NAME'),
        port: inteiro('DB_PORT', 3306, 1, 65535),
        connectionLimit: inteiro('DB_CONNECTION_LIMIT', 10, 2, 50),
        queueLimit: inteiro('DB_QUEUE_LIMIT', 100, 1, 5000),
        connectTimeoutMs: inteiro('DB_CONNECT_TIMEOUT_MS', 10000, 1000, 60000),
        ssl: booleano('DB_SSL', false)
    },

    security: {
        pepper: chaveBase64('PORTAL_SECURITY_PEPPER', 32),
        cookieName: String(process.env.SESSION_COOKIE_NAME || (production ? '__Host-itr_portal_session' : 'itr_portal_session')),
        normalSessionHours: inteiro('SESSION_HOURS', 12, 1, 72),
        rememberDays: inteiro('SESSION_REMEMBER_DAYS', 7, 1, 30),
        directorSessionHours: inteiro('DIRECTOR_SESSION_HOURS', 12, 1, 24),
        trustProxyHops: inteiro('TRUST_PROXY_HOPS', render ? 1 : 0, 0, 5),
        safeMode: booleano('PORTAL_SAFE_MODE', !production),
        writeEnabled: booleano('PORTAL_WRITE_ENABLED', false),
        loginIpLimit: inteiro('LOGIN_MAX_TENTATIVAS_IP', 40, 3, 200),
        loginAccountLimit: inteiro('LOGIN_MAX_TENTATIVAS_CONTA', 10, 3, 100),
        directorLoginLimit: inteiro('DIRETOR_MAX_TENTATIVAS', 8, 3, 50),
        auditRetentionDays: inteiro('AUDIT_RETENTION_DAYS', 180, 30, 730)
    },

    clientAuth: {
        enabled: booleano('CLIENT_PASSWORDS_ENABLED', false),
        passwordMinLength: inteiro('CLIENT_PASSWORD_MIN_LENGTH', 12, 10, 64),
        passwordMaxLength: inteiro('CLIENT_PASSWORD_MAX_LENGTH', 128, 32, 256),
        activationTokenMinutes: inteiro('CLIENT_ACTIVATION_TOKEN_MINUTES', 30, 5, 120),
        resetTokenMinutes: inteiro('CLIENT_RESET_TOKEN_MINUTES', 20, 5, 120),
        onboardingVersion: inteiro('CLIENT_ONBOARDING_VERSION', 1, 1, 100),
        requestIpLimit: inteiro('PASSWORD_REQUEST_IP_LIMIT', 20, 3, 100),
        requestAccountLimit: inteiro('PASSWORD_REQUEST_ACCOUNT_LIMIT', 5, 2, 30),
        confirmIpLimit: inteiro('PASSWORD_CONFIRM_IP_LIMIT', 15, 3, 100)
    },

    notifications: {
        url: urlOpcional('PORTAL_NOTIFICATIONS_URL'),
        secret: chaveBase64Opcional('PORTAL_NOTIFICATIONS_HMAC_SECRET', 32),
        timeoutMs: inteiro('PORTAL_NOTIFICATIONS_TIMEOUT_MS', 10000, 1000, 30000)
    }
};

if (!/^https?:\/\//i.test(config.publicOrigin)) {
    throw new Error('PUBLIC_APP_ORIGIN precisa ser uma origem HTTP/HTTPS válida.');
}

if (production && !config.publicOrigin.startsWith('https://')) {
    throw new Error('Em produção, PUBLIC_APP_ORIGIN deve usar HTTPS.');
}

const origin = new URL(config.publicOrigin);
if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('PUBLIC_APP_ORIGIN deve conter somente esquema + host, sem caminho, credenciais ou parâmetros.');
}
if (production && config.security.safeMode && config.security.writeEnabled) {
    throw new Error('Configuração incoerente: PORTAL_SAFE_MODE=true não pode ser combinada com PORTAL_WRITE_ENABLED=true.');
}

if (config.clientAuth.enabled) {
    if (!config.notifications.url || !config.notifications.secret) {
        throw new Error('CLIENT_PASSWORDS_ENABLED=true exige PORTAL_NOTIFICATIONS_URL e PORTAL_NOTIFICATIONS_HMAC_SECRET.');
    }
    const notifyUrl = new URL(config.notifications.url);
    if (production && notifyUrl.protocol !== 'https:') {
        throw new Error('Em produção, PORTAL_NOTIFICATIONS_URL deve usar HTTPS.');
    }
}

module.exports = config;
