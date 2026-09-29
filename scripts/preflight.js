'use strict';

const config = require('../config');
const pool = require('../db');
const { verificarBanco, encerrarBanco } = require('../db');
const { verificarAirtable } = require('../airtable');

async function verificarSchemaAutenticacao() {
  const obrigatorias = ['portal_sessions', 'portal_rate_limits', 'portal_audit_events', 'portal_director', 'ultimo_acesso_cliente', 'relatorios_baixados'];
  const [rows] = await pool.query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${obrigatorias.map(() => '?').join(',')})`,
    obrigatorias
  );
  const presentes = new Set(rows.map(r => r.TABLE_NAME));
  const faltando = obrigatorias.filter(t => !presentes.has(t));
  if (faltando.length) throw new Error(`rode npm run migrate; faltam: ${faltando.join(', ')}`);
  return true;
}

async function main() {
  const itens = [];
  try { await verificarBanco(); itens.push(['MySQL', true]); } catch (e) { itens.push(['MySQL', false, e.message]); }
  try { await verificarAirtable(); itens.push(['Airtable', true]); } catch (e) { itens.push(['Airtable', false, e.message]); }
  try { await verificarSchemaAutenticacao(); itens.push(['Schema de autenticação', true]); } catch (e) { itens.push(['Schema de autenticação', false, e.message]); }

  console.log(`[preflight] ambiente: ${config.nodeEnv}`);
  console.log(`[preflight] origem pública: ${config.publicOrigin}`);
  console.log(`[preflight] modo seguro: ${config.security.safeMode || !config.security.writeEnabled ? 'ATIVO' : 'desativado'}`);
  console.log(`[preflight] senhas de clientes: CNPJ + senha gerada (6 dígitos)`);
  console.log(`[preflight] notificações internas: ${config.notifications.url ? 'configuradas' : 'não configuradas'}`);
  itens.forEach(([nome, ok, detalhe]) => console.log(`[preflight] ${nome}: ${ok ? 'OK' : 'FALHA'}${detalhe ? ` — ${detalhe}` : ''}`));
  if (itens.some(item => !item[1])) process.exitCode = 1;
}

main().finally(() => encerrarBanco().catch(() => {}));
