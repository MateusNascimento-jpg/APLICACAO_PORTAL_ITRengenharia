'use strict';

const pool = require('../db');
const config = require('../config');
const {
  hmac,
  sha256,
  randomToken,
  scryptHash,
  scryptVerify
} = require('./security-crypto');

const PURPOSE_ACTIVATE = 'ACTIVATE';
const PURPOSE_RESET = 'RESET';

const COMMON_PASSWORDS = new Set([
  '123456789012',
  '123456789123',
  'senha12345678',
  'password1234',
  'qwerty123456',
  'itrengenharia',
  'itrengenharia123'
]);

function passwordPolicy(password, identity = {}) {
  const value = String(password ?? '');
  const min = config.clientAuth.passwordMinLength;
  const max = config.clientAuth.passwordMaxLength;

  if (value.length < min) {
    return { ok: false, message: `Sua senha precisa ter pelo menos ${min} caracteres.` };
  }
  if (value.length > max || Buffer.byteLength(value, 'utf8') > 512) {
    return { ok: false, message: `Sua senha pode ter no máximo ${max} caracteres.` };
  }
  if (value !== value.trim()) {
    return { ok: false, message: 'Evite espaços no início ou no fim da senha.' };
  }

  const lower = value.toLocaleLowerCase('pt-BR');
  if (COMMON_PASSWORDS.has(lower)) {
    return { ok: false, message: 'Escolha uma senha menos previsível.' };
  }

  const cnpj = String(identity.cnpj || '').replace(/\D/g, '');
  if (cnpj.length === 14 && lower.includes(cnpj)) {
    return { ok: false, message: 'A senha não pode conter o CNPJ da empresa.' };
  }

  const email = String(identity.email || '').trim().toLocaleLowerCase('pt-BR');
  const local = email.split('@')[0] || '';
  if (local.length >= 5 && lower.includes(local)) {
    return { ok: false, message: 'A senha não pode conter seu e-mail de acesso.' };
  }

  return { ok: true };
}

async function getAccount(airtableId) {
  const [rows] = await pool.query(
    `SELECT airtable_client_id, password_hash, password_salt,
            onboarding_version, onboarding_completed_at, onboarding_dismissed_at,
            created_at, updated_at, last_login_at
     FROM portal_client_accounts
     WHERE airtable_client_id = ? LIMIT 1`,
    [airtableId]
  );
  return rows[0] || null;
}

async function verifyPassword(airtableId, password) {
  const account = await getAccount(airtableId);
  if (!account) return { exists: false, ok: false, account: null };
  const ok = await scryptVerify(password, account.password_salt, account.password_hash);
  return { exists: true, ok, account };
}

async function touchLogin(airtableId) {
  await pool.query(
    'UPDATE portal_client_accounts SET last_login_at = NOW(3) WHERE airtable_client_id = ?',
    [airtableId]
  );
}

function tokenTtlMinutes(purpose) {
  return purpose === PURPOSE_ACTIVATE
    ? config.clientAuth.activationTokenMinutes
    : config.clientAuth.resetTokenMinutes;
}

async function createPasswordToken({ airtableId, purpose, req }) {
  if (![PURPOSE_ACTIVATE, PURPOSE_RESET].includes(purpose)) {
    throw new Error('Finalidade de token inválida.');
  }

  const raw = randomToken(32);
  const tokenHash = sha256(raw);
  const expiresAt = new Date(Date.now() + tokenTtlMinutes(purpose) * 60 * 1000);
  await pool.query(
    `INSERT INTO portal_password_tokens
     (token_hash, airtable_client_id, purpose, expires_at, requested_ip_hash, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      tokenHash,
      airtableId,
      purpose,
      expiresAt,
      req?.ip ? hmac(req.ip) : null,
      String(req?.headers?.['user-agent'] || '').slice(0, 255) || null
    ]
  );
  return { raw, expiresAt };
}

async function peekPasswordToken(raw) {
  if (!raw || String(raw).length < 30 || String(raw).length > 256) return null;
  const [rows] = await pool.query(
    `SELECT token_hash, airtable_client_id, purpose, expires_at, used_at
     FROM portal_password_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW(3)
     LIMIT 1`,
    [sha256(String(raw))]
  );
  return rows[0] || null;
}

async function invalidateToken(raw) {
  if (!raw) return;
  await pool.query(
    'UPDATE portal_password_tokens SET used_at = COALESCE(used_at, NOW(3)) WHERE token_hash = ?',
    [sha256(String(raw))]
  );
}

async function activateAccount(rawToken, password, client) {
  const policy = passwordPolicy(password, { cnpj: client.cnpj, email: client.emailLogin });
  if (!policy.ok) {
    const error = new Error(policy.message);
    error.code = 'WEAK_PASSWORD';
    throw error;
  }

  const { salt, hash } = await scryptHash(password);
  const tokenHash = sha256(String(rawToken || ''));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [tokens] = await conn.query(
      `SELECT airtable_client_id, purpose
       FROM portal_password_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW(3)
       FOR UPDATE`,
      [tokenHash]
    );
    const token = tokens[0];
    if (!token || token.purpose !== PURPOSE_ACTIVATE || token.airtable_client_id !== client.id) {
      const error = new Error('Este link de primeiro acesso é inválido ou expirou.');
      error.code = 'TOKEN_INVALID';
      throw error;
    }

    const [accounts] = await conn.query(
      'SELECT airtable_client_id FROM portal_client_accounts WHERE airtable_client_id = ? FOR UPDATE',
      [client.id]
    );
    if (accounts[0]) {
      const error = new Error('A senha desta conta já foi criada. Use o login normal ou a recuperação de senha.');
      error.code = 'ACCOUNT_EXISTS';
      throw error;
    }

    await conn.query(
      `INSERT INTO portal_client_accounts
       (airtable_client_id, password_hash, password_salt, password_created_at, password_changed_at)
       VALUES (?, ?, ?, NOW(3), NOW(3))`,
      [client.id, hash, salt]
    );
    await conn.query(
      'UPDATE portal_password_tokens SET used_at = COALESCE(used_at, NOW(3)) WHERE airtable_client_id = ?',
      [client.id]
    );
    await conn.commit();
    return true;
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    throw error;
  } finally {
    conn.release();
  }
}

async function resetPasswordWithToken(rawToken, password, client) {
  const policy = passwordPolicy(password, { cnpj: client.cnpj, email: client.emailLogin });
  if (!policy.ok) {
    const error = new Error(policy.message);
    error.code = 'WEAK_PASSWORD';
    throw error;
  }

  const { salt, hash } = await scryptHash(password);
  const tokenHash = sha256(String(rawToken || ''));
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [tokens] = await conn.query(
      `SELECT airtable_client_id, purpose
       FROM portal_password_tokens
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW(3)
       FOR UPDATE`,
      [tokenHash]
    );
    const token = tokens[0];
    if (!token || token.purpose !== PURPOSE_RESET || token.airtable_client_id !== client.id) {
      const error = new Error('Este link de recuperação é inválido ou expirou.');
      error.code = 'TOKEN_INVALID';
      throw error;
    }

    const [accounts] = await conn.query(
      'SELECT airtable_client_id FROM portal_client_accounts WHERE airtable_client_id = ? FOR UPDATE',
      [client.id]
    );
    if (!accounts[0]) {
      const error = new Error('Esta conta ainda não possui senha pessoal. Use o primeiro acesso.');
      error.code = 'ACCOUNT_MISSING';
      throw error;
    }

    await conn.query(
      `UPDATE portal_client_accounts
       SET password_hash = ?, password_salt = ?, password_changed_at = NOW(3)
       WHERE airtable_client_id = ?`,
      [hash, salt, client.id]
    );
    await conn.query('DELETE FROM portal_sessions WHERE airtable_client_id = ?', [client.id]);
    await conn.query(
      'UPDATE portal_password_tokens SET used_at = COALESCE(used_at, NOW(3)) WHERE airtable_client_id = ?',
      [client.id]
    );
    await conn.commit();
    return true;
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    throw error;
  } finally {
    conn.release();
  }
}

async function changePassword({ airtableId, currentPassword, newPassword, client }) {
  const policy = passwordPolicy(newPassword, { cnpj: client.cnpj, email: client.emailLogin });
  if (!policy.ok) {
    const error = new Error(policy.message);
    error.code = 'WEAK_PASSWORD';
    throw error;
  }

  const { salt, hash } = await scryptHash(newPassword);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT password_hash, password_salt
       FROM portal_client_accounts
       WHERE airtable_client_id = ? FOR UPDATE`,
      [airtableId]
    );
    const account = rows[0];
    if (!account) {
      const error = new Error('A conta ainda não possui senha pessoal.');
      error.code = 'ACCOUNT_MISSING';
      throw error;
    }

    const currentOk = await scryptVerify(currentPassword, account.password_salt, account.password_hash);
    if (!currentOk) {
      const error = new Error('A senha atual não confere.');
      error.code = 'CURRENT_PASSWORD_INVALID';
      throw error;
    }
    const same = await scryptVerify(newPassword, account.password_salt, account.password_hash);
    if (same) {
      const error = new Error('Escolha uma senha diferente da atual.');
      error.code = 'PASSWORD_REUSED';
      throw error;
    }

    await conn.query(
      `UPDATE portal_client_accounts
       SET password_hash = ?, password_salt = ?, password_changed_at = NOW(3)
       WHERE airtable_client_id = ?`,
      [hash, salt, airtableId]
    );
    await conn.query('DELETE FROM portal_sessions WHERE airtable_client_id = ?', [airtableId]);
    await conn.query(
      'UPDATE portal_password_tokens SET used_at = COALESCE(used_at, NOW(3)) WHERE airtable_client_id = ?',
      [airtableId]
    );
    await conn.commit();
    return true;
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    throw error;
  } finally {
    conn.release();
  }
}

async function onboardingState(airtableId) {
  const account = await getAccount(airtableId);
  if (!account) return null;
  return {
    version: Number(account.onboarding_version || 0),
    completedAt: account.onboarding_completed_at || null,
    dismissedAt: account.onboarding_dismissed_at || null
  };
}

async function markOnboarding(airtableId, mode) {
  const version = config.clientAuth.onboardingVersion;
  if (mode === 'completed') {
    await pool.query(
      `UPDATE portal_client_accounts
       SET onboarding_version = ?, onboarding_completed_at = NOW(3), onboarding_dismissed_at = NULL
       WHERE airtable_client_id = ?`,
      [version, airtableId]
    );
  } else if (mode === 'dismissed') {
    await pool.query(
      `UPDATE portal_client_accounts
       SET onboarding_version = ?, onboarding_dismissed_at = NOW(3)
       WHERE airtable_client_id = ?`,
      [version, airtableId]
    );
  } else {
    throw new Error('Estado de onboarding inválido.');
  }
}

async function cleanupPasswordTokens() {
  await pool.query(
    `DELETE FROM portal_password_tokens
     WHERE expires_at < DATE_SUB(NOW(3), INTERVAL 1 DAY)
        OR used_at < DATE_SUB(NOW(3), INTERVAL 7 DAY)`
  );
}

module.exports = {
  PURPOSE_ACTIVATE,
  PURPOSE_RESET,
  passwordPolicy,
  getAccount,
  verifyPassword,
  touchLogin,
  createPasswordToken,
  peekPasswordToken,
  invalidateToken,
  activateAccount,
  resetPasswordWithToken,
  changePassword,
  onboardingState,
  markOnboarding,
  cleanupPasswordTokens
};
