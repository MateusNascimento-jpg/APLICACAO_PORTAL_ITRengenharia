
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildClientScopes } = require('../lib/client-scope');

function client(id, idCliente, nome, cnpj, email) {
  return { id, fields: { 'ID Cliente': idCliente, 'Nome Cliente': nome, CNPJ: cnpj, 'Email Cliente': email } };
}
function work(id, clientId, owner, sample) {
  return { id, createdTime: '2026-09-01T12:00:00.000Z', fields: { Cliente: [clientId], 'ID Trabalho': `${owner}_${sample} | MR`, 'Link Amostras': sample } };
}

const A='recAAAAAAAAAAAAAA', B='recBBBBBBBBBBBBBB', C='recCCCCCCCCCCCCCC';

test('CNPJs diferentes permanecem separados apesar de owner consistente', () => {
  const clients=[client(A,'Grupo Aterpa','Grupo Aterpa','17162983000165','a@aterpa.com.br'),client(B,'Aterpa - Macae','Grupo Aterpa','17162983005124','b@aterpa.com.br')];
  const works=[];
  for(let i=0;i<8;i++) works.push(work(`recA${String(i).padStart(13,'0')}`,A,'Grupo Aterpa',`KM 300 ${i}`));
  for(let i=0;i<8;i++) works.push(work(`recB${String(i).padStart(13,'0')}`,B,'Grupo Aterpa',`NR 30 ${i}`));
  const model=buildClientScopes(clients,works);
  assert.deepEqual(model.scopeByClientId.get(A).clientIds,[A]);
});

test('mesmo CNPJ une automaticamente', () => {
  const clients=[client(A,'A','A','11111111111111','a@x.com'),client(B,'B','B','11111111111111','b@y.com')];
  const model=buildClientScopes(clients,[]);
  assert.equal(model.scopeByClientId.get(A).canonicalId,model.scopeByClientId.get(B).canonicalId);
});

test('mesmo email não autoriza união entre CNPJs', () => {
  const clients=[client(A,'A','A','11111111111111','financeiro@empresa.com'),client(B,'B','B','22222222222222','financeiro@empresa.com')];
  const model=buildClientScopes(clients,[]);
  assert.notEqual(model.scopeByClientId.get(A).canonicalId,model.scopeByClientId.get(B).canonicalId);
});

test('uma amostra textual igual nao une tenants distintos', () => {
  const clients=[client(A,'Empresa A','Empresa A','11111111111111','a@a.com'),client(B,'Empresa B','Empresa B','22222222222222','b@b.com')];
  const works=[work('recD0000000000000',A,'Empresa A','Brita 0 Pedreira X'),work('recE0000000000000',B,'Empresa B','Brita 0 Pedreira X')];
  const model=buildClientScopes(clients,works);
  assert.notEqual(model.scopeByClientId.get(A).canonicalId,model.scopeByClientId.get(B).canonicalId);
});

test('sobreposição de amostras não autoriza união entre CNPJs', () => {
  const clients=[client(A,'Unidade Norte','Empresa Z','11111111111111','norte@z.com'),client(B,'Unidade Sul','Empresa Z','22222222222222','sul@z.com'),client(C,'Outro','Outro','33333333333333','o@o.com')];
  const works=[];
  for(let i=0;i<7;i++){ const sample=`Amostra exclusiva projeto alpha ${i}`; works.push({id:`recF${String(i).padStart(13,'0')}`,fields:{Cliente:[A],'ID Trabalho':`A_${i}`,'Link Amostras':sample}}); works.push({id:`recG${String(i).padStart(13,'0')}`,fields:{Cliente:[B],'ID Trabalho':`B_${i}`,'Link Amostras':sample}}); }
  works.push(work('recH0000000000000',C,'Outro','Amostra completamente distinta'));
  const model=buildClientScopes(clients,works);
  assert.notEqual(model.scopeByClientId.get(A).canonicalId,model.scopeByClientId.get(B).canonicalId);
  assert.notEqual(model.scopeByClientId.get(A).canonicalId,model.scopeByClientId.get(C).canonicalId);
});


test('trabalho compartilhado não expande escopo; vínculo administrativo explícito autoriza', () => {
  const clients = [client(A, 'A', 'A', '11111111111111', 'x@x.com'), client(B, 'B', 'B', '22222222222222', 'x@x.com')];
  const works = [{ id: 'recShared', fields: { Cliente: [A, B] } }];
  assert.deepEqual(buildClientScopes(clients, works).scopeByClientId.get(A).clientIds, [A]);
  assert.deepEqual(buildClientScopes(clients, works, { overrides: [[A, B]] }).scopeByClientId.get(A).clientIds.sort(), [A, B]);
});
