
'use strict';

// Resolver de escopo empresarial (code-only).
//
// Objetivo: converter um cliente-semente do Airtable em uma lista explícita de
// Record IDs autorizados. Sinais textuais servem para DESCOBERTA, nunca para
// autorizar um trabalho individual; a autorização final continua pelo array
// linked-record Cliente de cada trabalho.

const GENERIC_OWNER_KEYS = new Set([
  'cliente', 'empresa', 'grupo', 'matriz', 'filial', 'itr engenharia', 'itr'
]);

function normalizarTexto(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarCnpj(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 14 ? digits : '';
}

function normalizarEmails(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.flatMap(v => String(v)
    .split(/[\r\n;,]+/)
    .map(e => e.trim().toLowerCase())
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))))];
}

function lista(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function ownerKeyFromWorkId(value) {
  const raw = String(value || '').trim();
  const idx = raw.indexOf('_');
  if (idx <= 0) return '';
  const key = normalizarTexto(raw.slice(0, idx));
  if (key.length < 4 || GENERIC_OWNER_KEYS.has(key)) return '';
  return key;
}

function sampleTextKeys(fields = {}) {
  const out = new Set();
  for (const field of ['Link Amostras', 'Nome da Amostra', 'Amostra', 'ID Amostra']) {
    for (const value of lista(fields[field])) {
      const key = normalizarTexto(value);
      // Textos curtos/genericos nao devem se tornar identidade de tenant.
      if (key.length >= 7 && !/^registro\s+\d+$/i.test(key)) out.add(key);
    }
  }
  return out;
}

function sampleRecordIds(fields = {}) {
  const out = new Set();
  for (const field of ['Link Amostras', 'Amostras', 'Amostra']) {
    for (const value of lista(fields[field])) {
      const s = String(value || '').trim();
      if (/^rec[a-zA-Z0-9]{14}$/.test(s)) out.add(s);
    }
  }
  return out;
}

class UnionFind {
  constructor(ids) {
    this.parent = new Map(ids.map(id => [id, id]));
    this.rank = new Map(ids.map(id => [id, 0]));
  }
  find(id) {
    const p = this.parent.get(id);
    if (p !== id) this.parent.set(id, this.find(p));
    return this.parent.get(id);
  }
  union(a, b) {
    let ra = this.find(a); let rb = this.find(b);
    if (ra === rb) return;
    const aa = this.rank.get(ra) || 0; const bb = this.rank.get(rb) || 0;
    if (aa < bb) [ra, rb] = [rb, ra];
    this.parent.set(rb, ra);
    if (aa === bb) this.rank.set(ra, aa + 1);
  }
}

function intersectionSize(a, b, allowed = null) {
  let small = a; let large = b;
  if (a.size > b.size) { small = b; large = a; }
  let count = 0;
  for (const x of small) {
    if (large.has(x) && (!allowed || allowed.has(x))) count += 1;
  }
  return count;
}

function escolherCanonico(members, features) {
  const ownerCandidates = new Map();
  for (const id of members) {
    const f = features.get(id);
    if (f.ownerConsensus) ownerCandidates.set(f.ownerConsensus, (ownerCandidates.get(f.ownerConsensus) || 0) + 1);
  }
  const sharedOwner = [...ownerCandidates.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  if (sharedOwner) {
    const exact = members.find(id => {
      const f = features.get(id);
      return f.idClienteKey === sharedOwner || f.nomeKey === sharedOwner;
    });
    if (exact) return exact;
  }
  return [...members].sort((a, b) => {
    const aw = features.get(a).workCount || 0;
    const bw = features.get(b).workCount || 0;
    if (bw !== aw) return bw - aw;
    return a.localeCompare(b);
  })[0];
}

function buildClientScopes(clientRecords, workRecords, options = {}) {
  const cfg = {
    ownerMinWorks: options.ownerMinWorks ?? 3,
    ownerConsensusRatio: options.ownerConsensusRatio ?? 0.70,
    emailMaxFanout: options.emailMaxFanout ?? 4,
    sampleTextMinShared: options.sampleTextMinShared ?? 5,
    sampleTextMinOverlap: options.sampleTextMinOverlap ?? 0.55,
    sampleTextMaxFanout: options.sampleTextMaxFanout ?? 2,
    overrides: Array.isArray(options.overrides) ? options.overrides : []
  };

  const ids = clientRecords.map(r => r.id).filter(Boolean);
  const idSet = new Set(ids);
  const features = new Map(ids.map(id => [id, {
    id,
    workCount: 0,
    cnpjs: new Set(), emails: new Set(), names: new Set(), idNames: new Set(),
    samples: new Set(), sampleRecordIds: new Set(), ownerCounts: new Map(),
    nomeKey: '', idClienteKey: '', ownerConsensus: ''
  }]));

  for (const rec of clientRecords) {
    const f = features.get(rec.id); if (!f) continue;
    const fields = rec.fields || {};
    const cnpj = normalizarCnpj(fields.CNPJ); if (cnpj) f.cnpjs.add(cnpj);
    const emailField = fields['Email Cliente'] ?? fields.Email ?? fields['E-mail'];
    for (const email of normalizarEmails(emailField)) f.emails.add(email);
    f.nomeKey = normalizarTexto(fields['Nome Cliente']);
    f.idClienteKey = normalizarTexto(fields['ID Cliente']);
    if (f.nomeKey) f.names.add(f.nomeKey);
    if (f.idClienteKey) f.idNames.add(f.idClienteKey);
  }

  const explicitPairs = [];
  for (const work of workRecords) {
    const fields = work.fields || {};
    const links = lista(fields.Cliente).filter(id => idSet.has(id));
    if (!links.length) continue;
    if (links.length > 1) {
      for (let i = 0; i < links.length; i += 1) for (let j = i + 1; j < links.length; j += 1) explicitPairs.push([links[i], links[j], 'same-linked-work']);
    }
    const owner = ownerKeyFromWorkId(fields['ID Trabalho']);
    const sampleTexts = sampleTextKeys(fields);
    const sampleIds = sampleRecordIds(fields);
    for (const clientId of links) {
      const f = features.get(clientId); if (!f) continue;
      f.workCount += 1;
      if (owner) f.ownerCounts.set(owner, (f.ownerCounts.get(owner) || 0) + 1);
      for (const s of sampleTexts) f.samples.add(s);
      for (const s of sampleIds) f.sampleRecordIds.add(s);
    }
  }

  for (const f of features.values()) {
    const top = [...f.ownerCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= cfg.ownerMinWorks && top[1] / Math.max(1, f.workCount) >= cfg.ownerConsensusRatio) f.ownerConsensus = top[0];
  }

  const emailFanout = new Map();
  const sampleFanout = new Map();
  for (const f of features.values()) {
    for (const email of f.emails) emailFanout.set(email, (emailFanout.get(email) || 0) + 1);
    for (const sample of f.samples) sampleFanout.set(sample, (sampleFanout.get(sample) || 0) + 1);
  }
  const rareSamples = new Set([...sampleFanout.entries()].filter(([, n]) => n <= cfg.sampleTextMaxFanout).map(([k]) => k));

  const uf = new UnionFind(ids);
  const evidence = [];
  const connect = (a, b, reason, detail = {}) => {
    if (!idSet.has(a) || !idSet.has(b) || a === b) return;
    uf.union(a, b); evidence.push({ a, b, reason, ...detail });
  };

  // Heurísticas somente para diagnóstico; nunca autorizam acesso por padrão.
  if (options.diagnosticHeuristics === true) for (const [a, b, reason] of explicitPairs) connect(a, b, reason);

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = features.get(ids[i]); const b = features.get(ids[j]);
      const cnpjShared = intersectionSize(a.cnpjs, b.cnpjs);
      if (cnpjShared > 0) { connect(a.id, b.id, 'same-cnpj'); continue; }
      if (options.diagnosticHeuristics !== true) continue;

      const commonEmails = [...a.emails].filter(e => b.emails.has(e) && (emailFanout.get(e) || 0) <= cfg.emailMaxFanout);
      if (commonEmails.length) { connect(a.id, b.id, 'same-email', { count: commonEmails.length }); continue; }

      const sampleRecShared = intersectionSize(a.sampleRecordIds, b.sampleRecordIds);
      if (sampleRecShared > 0) { connect(a.id, b.id, 'same-sample-record-id', { count: sampleRecShared }); continue; }

      if (a.ownerConsensus && a.ownerConsensus === b.ownerConsensus) {
        connect(a.id, b.id, 'same-owner-consensus', { owner: a.ownerConsensus });
        continue;
      }

      // Mesmo texto de uma unica amostra NUNCA autoriza uniao. Para tornar
      // sobreposicao textual um sinal forte, exigimos varias amostras exatas,
      // raras na base, e uma razao de sobreposicao alta.
      const sharedRare = intersectionSize(a.samples, b.samples, rareSamples);
      const overlap = sharedRare / Math.max(1, Math.min(a.samples.size, b.samples.size));
      if (sharedRare >= cfg.sampleTextMinShared && overlap >= cfg.sampleTextMinOverlap) {
        connect(a.id, b.id, 'strong-sample-overlap', { shared: sharedRare, overlap });
        continue;
      }

      // Sinais de nome so reforcam uma sobreposicao real; nome sozinho nao
      // amplia tenant, evitando homonimos e cadastro inconsistente.
      const sameName = a.nomeKey && a.nomeKey === b.nomeKey;
      const sameIdName = a.idClienteKey && a.idClienteKey === b.idClienteKey;
      if ((sameName || sameIdName) && sharedRare >= 2 && overlap >= 0.35) {
        connect(a.id, b.id, 'name-plus-samples', { shared: sharedRare, overlap });
      }
    }
  }

  for (const group of cfg.overrides) {
    const valid = [...new Set((Array.isArray(group) ? group : []).filter(id => idSet.has(id)))];
    for (let i = 1; i < valid.length; i += 1) connect(valid[0], valid[i], 'code-override');
  }

  const components = new Map();
  for (const id of ids) {
    const root = uf.find(id);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(id);
  }

  const scopeByClientId = new Map();
  const scopes = [];
  for (const members of components.values()) {
    const memberSet = new Set(members);
    const canonicalId = escolherCanonico(members, features);
    const reasons = evidence.filter(e => memberSet.has(e.a) && memberSet.has(e.b));
    const scope = { canonicalId, clientIds: [...members].sort(), evidence: reasons };
    scopes.push(scope);
    for (const id of members) scopeByClientId.set(id, scope);
  }

  return { scopes, scopeByClientId, features };
}

module.exports = {
  normalizarTexto,
  normalizarCnpj,
  normalizarEmails,
  ownerKeyFromWorkId,
  sampleTextKeys,
  sampleRecordIds,
  buildClientScopes
};
