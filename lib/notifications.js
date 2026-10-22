'use strict';

const crypto = require('crypto');
const config = require('../config');
const { randomToken } = require('./security-crypto');
const { fingerprintAcesso, validarRegraSenha } = require('./confluence-contract');

const TYPES = new Set([
  'ACCESS_REQUEST',
  'FIRST_ACCESS',
  'PASSWORD_RESET',
  'PASSWORD_CREATED',
  'PASSWORD_CHANGED'
]);

function isConfigured() {
  return Boolean(config.notifications.url && config.notifications.secret);
}

async function sendSecurityNotification(type, { client, actionUrl = null }) {
  if (!TYPES.has(type)) throw new Error('Tipo de notificação de segurança inválido.');
  if (!isConfigured()) throw new Error('Serviço interno de notificações não está configurado.');

  const payload = {
    type,
    client: {
      name: client.idCliente || client.nome || 'Cliente',
      cnpj: client.cnpj,
      email: client.emailLogin,
      ...(type === 'ACCESS_REQUEST' ? { emails: client.emails, accessPassword: client.accessPassword } : {}),
      whatsapp: client.whatsapp || null
    },
    actionUrl: actionUrl || null
  };
  return requestSigned('/internal/portal/security-notification', payload);
}

async function probeNotifications() {
  if (!validarRegraSenha()) throw new Error('Regra local de senha de acesso divergiu do contrato.');
  const expected = fingerprintAcesso();
  const response = await requestSigned('/internal/portal/diagnostic', { probe: true });
  if (response.service !== 'itr-emails-whatsapp' || response.protocol !== 1 || response.emailSent !== false) {
    throw new Error('Destino não corresponde à versão esperada do serviço de notificações.');
  }
  if (response.contractFingerprint !== expected) {
    throw new Error('Contrato Airtable divergente (base, tabela ou campo Sigla) ou serviço de notificações desatualizado.');
  }
  if (!Number.isSafeInteger(response.serverTime) || Math.abs(Math.floor(Date.now() / 1000) - response.serverTime) > 180) {
    throw new Error('Relógios dos serviços divergentes ou resposta de diagnóstico inválida (verifique NTP).');
  }
  return response;
}

async function requestSigned(route, payload) {
  if (!isConfigured()) throw new Error('Serviço interno de notificações não está configurado.');
  const destination = new URL(config.notifications.url);
  if (destination.pathname !== '/' || destination.search || destination.hash || destination.username || destination.password) {
    throw new Error('PORTAL_NOTIFICATIONS_URL deve conter somente a origem HTTPS do serviço de e-mails, sem caminho.');
  }
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomToken(18);
  const secret = Buffer.from(config.notifications.secret, 'base64');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.`, 'utf8')
    .update(body, 'utf8')
    .digest('hex');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.notifications.timeoutMs);
  try {
    const resp = await fetch(`${destination.origin}${route}`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-ITR-Timestamp': timestamp,
        'X-ITR-Nonce': nonce,
        'X-ITR-Signature': signature
      },
      body,
      signal: controller.signal
    });
    let data = null;
    try { data = await resp.json(); } catch (_) {}
    if (!resp.ok || !data?.ok) {
      const allowed = new Set(['assinatura-invalida', 'timestamp-invalido', 'nonce-repetido', 'segredo-nao-configurado', 'payload-invalido', 'modo-teste-email-ativo', 'notification-unavailable', 'contrato-invalido']);
      const reason = allowed.has(data?.motivo) ? data.motivo : (resp.status >= 300 && resp.status < 400 ? 'redirecionamento-recusado' : 'resposta-inesperada');
      throw new Error(`Serviço de notificações recusou a solicitação (HTTP ${resp.status}; motivo=${reason}; destino=${destination.origin}; rota=${route}).`);
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Tempo esgotado ao chamar notificações; destino=${destination.origin}.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendSecurityNotification, isConfigured, probeNotifications };
