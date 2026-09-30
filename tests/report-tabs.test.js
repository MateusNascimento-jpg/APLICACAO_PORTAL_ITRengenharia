'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/assets/js/portal.js'),'utf8');
const fn=source.slice(source.indexOf('function baixarRelatorio('),source.indexOf('// Conteúdo dos cards'));
function element(){return {attrs:{},children:[],textContent:'',setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k];},removeAttribute(k){delete this.attrs[k];},appendChild(c){this.children.push(c);},querySelector(){return null;}};}
async function scenario({count=1,blocked=[],files=1,status=200}={}){
 const opened=[];const parent=element();const button=element();button.parentNode=parent;
 const doc={createElement:element};let index=0;let phase='click';
 const urls=Array.from({length:files},(_,i)=>({arquivo:'arquivo '+i+'.pdf',url:'/api/relatorio/recAAAAAAAAAAAAAA?arquivo=att'+i}));
 const win={location:{origin:'https://portal.itr.eng.br',assign(){throw Error('Portal nao pode navegar');},replace(){throw Error('Portal nao pode navegar');}},open(...args){assert.equal(phase,'click');assert.equal(args.length,2);const n=index++;if(blocked.includes(n))return null;const tab={closed:false,opener:win,document:{title:'',body:{}},location:{replace(url){tab.url=url;}},close(){this.closed=true;}};opened.push(tab);return tab;}};
 const context=vm.createContext({TODOS:[{id:'recAAAAAAAAAAAAAA',relatorios_quantidade:count}],document:doc,window:win,URL,alert(){throw Error('Aviso deve estar no card');},fetch:()=>{phase='fetch';return Promise.resolve({status,ok:status===200,json:async()=>({sucesso:status===200,arquivos:urls})});}});
 vm.runInContext(fn,context);context.baixarRelatorio({preventDefault(){},target:{closest(){return button;}}},'recAAAAAAAAAAAAAA');
 await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 return {opened,parent,button};
}
test('um PDF abre guia com referencia e opener nulo sem navegar no Portal',async()=>{
 const {opened,button}=await scenario();assert.equal(opened.length,1);assert.equal(opened[0].opener,null);assert.match(opened[0].url,/arquivo=att0$/);assert.match(opened[0].document.title,/Preparando PDF/);assert.equal(button.getAttribute('aria-busy'),undefined);
});
test('varios PDFs abrem guias distintas durante o clique',async()=>{
 const {opened}=await scenario({count:3,files:3});assert.equal(opened.length,3);assert.equal(new Set(opened.map(t=>t.url)).size,3);assert.ok(opened.every(t=>!t.closed));
});
test('bloqueio parcial oferece links seguros no card',async()=>{
 const {parent}=await scenario({count:3,files:3,blocked:[1,2]});const aviso=parent.children[0];assert.match(aviso.textContent,/não abriu todos/);const links=aviso.children[0].children.map(li=>li.children[0]);assert.equal(links.length,2);assert.ok(links.every(a=>a.target==='_blank'&&a.rel==='noopener noreferrer'));
});
test('sessao expirada fecha preparacao e mantem Portal aberto',async()=>{
 const {opened,parent}=await scenario({count:2,status:401});assert.ok(opened.every(a=>a.closed));assert.match(parent.children[0].textContent,/sessão expirou/);
});
test('anexo removido desde a listagem fecha a guia excedente',async()=>{
 const {opened}=await scenario({count:2,files:1});assert.ok(opened[0].url);assert.equal(opened[1].closed,true);
});
