'use strict';

const crypto = require('crypto');
const config = require('../config');
const { randomToken } = require('./security-crypto');

const TYPES = new Set([
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
      whatsapp: client.whatsapp || null
    },
    actionUrl: actionUrl || null
  };
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
    const resp = await fetch(`${config.notifications.url}/internal/portal/security-notification`, {
      method: 'POST',
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
      throw new Error(`Serviço de notificações recusou a solicitação (HTTP ${resp.status}).`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendSecurityNotification, isConfigured };
