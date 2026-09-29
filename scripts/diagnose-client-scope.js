'use strict';

const { buscarClientePorCnpj, buscarTrabalhosDoCliente, carregarScopeSnapshot } = require('../airtable');

async function main() {
  const args = process.argv.slice(2);
  const assertSame = args[0] === '--assert-same';
  const cnpjs = (assertSame ? args.slice(1) : args).map(v => String(v).replace(/\D/g, '')).filter(v => v.length === 14);
  if (!cnpjs.length) {
    const snapshot = await carregarScopeSnapshot(true);
    const proposed = require('../lib/client-scope').buildClientScopes(snapshot.clientes, snapshot.trabalhos, { diagnosticHeuristics: true });
    const suggestions = proposed.scopes.filter(s => s.clientIds.length > 1);
    const multi = snapshot.model.scopes.filter(s => s.clientIds.length > 1).map(s => ({ canonicalId: s.canonicalId, clientIds: s.clientIds, evidence: s.evidence }));
    console.log(JSON.stringify({ scopesAutorizados: multi, sugestoesNaoAutorizadas: suggestions }, null, 2));
    return;
  }

  const results = [];
  for (const cnpj of cnpjs) {
    const cliente = await buscarClientePorCnpj(cnpj);
    if (!cliente) throw new Error(`CNPJ nao encontrado: ${cnpj}`);
    const todos = await buscarTrabalhosDoCliente(cliente.id, null, 'todos', 3);
    const recente = await buscarTrabalhosDoCliente(cliente.id, null, 'recente', 3);
    results.push({
      cnpj,
      canonicalId: cliente.id,
      seedId: cliente.seedId,
      scopeClientIds: cliente.scopeClientIds,
      nome: cliente.idCliente || cliente.nome || null,
      trabalhosTodos: todos.trabalhos.length,
      trabalhosRecentes: recente.trabalhos.length,
      evidence: cliente.scopeEvidence
    });
  }

  if (assertSame && results.length > 1) {
    const signature = JSON.stringify([...results[0].scopeClientIds].sort());
    for (const r of results.slice(1)) {
      if (JSON.stringify([...r.scopeClientIds].sort()) !== signature) {
        console.error(JSON.stringify({ ok: false, reason: 'SCOPES_DIFFERENT', results }, null, 2));
        process.exit(2);
      }
    }
    if (results.some(r => r.trabalhosTodos <= 0)) {
      console.error(JSON.stringify({ ok: false, reason: 'NO_WORKS', results }, null, 2));
      process.exit(3);
    }
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
