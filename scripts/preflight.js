'use strict';

const config = require('../config');
const { verificarBanco, encerrarBanco } = require('../db');
const { verificarAirtable } = require('../airtable');

async function main() {
  const itens = [];
  try { await verificarBanco(); itens.push(['MySQL', true]); } catch (e) { itens.push(['MySQL', false, e.message]); }
  try { await verificarAirtable(); itens.push(['Airtable', true]); } catch (e) { itens.push(['Airtable', false, e.message]); }

  console.log(`[preflight] ambiente: ${config.nodeEnv}`);
  console.log(`[preflight] origem pública: ${config.publicOrigin}`);
  console.log(`[preflight] modo seguro: ${config.security.safeMode || !config.security.writeEnabled ? 'ATIVO' : 'desativado'}`);
  itens.forEach(([nome, ok, detalhe]) => console.log(`[preflight] ${nome}: ${ok ? 'OK' : 'FALHA'}${detalhe ? ` — ${detalhe}` : ''}`));
  if (itens.some(item => !item[1])) process.exitCode = 1;
}

main().finally(() => encerrarBanco().catch(() => {}));
