'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {pdfs,publicados}=require('../lib/report-attachments');
const a={id:'attA',filename:'a.pdf',url:'https://dl.airtable.com/a.pdf',type:'application/pdf'};
const b={id:'attB',filename:'b.PDF',url:'https://dl.airtable.com/b.pdf'};
test('anexos: um ou varios PDFs, ignorando fotos e preservando IDs',()=>{
 assert.equal(pdfs([a]).length,1);assert.deepEqual(pdfs([a,{id:'photo',filename:'foto.png'},b,a]).map(x=>x.id),['attA','attB']);
 assert.deepEqual(pdfs(null),[]);
});
test('aprovacao/desatualizacao permanece igual a 3.3.2; todos os publicados sao retornados',()=>{
 const fields={'Aprovação':'Aprovado','Relatórios_Aprovados':[a,b],'Relatórios':[a]};
 assert.deepEqual(publicados(fields).map(x=>x.id),['attA','attB']);
 assert.deepEqual(publicados({...fields,'Aprovação':'Pendente'}),[]);
 assert.deepEqual(publicados({...fields,'Relatórios':[{...a,filename:'novo.pdf'}]}),[]);
});
