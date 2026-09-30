'use strict';
const { createHash } = require('node:crypto');
function pdfs(campo) {
 if (!Array.isArray(campo)) return [];
 const seen = new Set();
 return campo.filter(a => a && (a.type === 'application/pdf' || String(a.filename || '').toLowerCase().endsWith('.pdf')))
 .map(a => ({ nome: a.filename, url: a.url, id: a.id || 'legacy-' + createHash('sha256').update(String(a.filename)+'\0'+String(a.url)).digest('hex') }))
 .filter(a => {if(seen.has(a.id))return false;seen.add(a.id);return true;});
}
// Mantém a regra de aprovação/desatualização da 3.3.2, ampliando somente a lista de saída.
function publicados(fields = {}) {
 if(fields['Aprovação'] !== 'Aprovado') return [];
 const aprovados=pdfs(fields['Relatórios_Aprovados']);
 const atual=pdfs(fields['Relatórios'])[0];
 const primeiro=aprovados[0];
 if(!primeiro || (atual && atual.nome && primeiro.nome && atual.nome !== primeiro.nome)) return [];
 return aprovados;
}
module.exports={pdfs,publicados};
