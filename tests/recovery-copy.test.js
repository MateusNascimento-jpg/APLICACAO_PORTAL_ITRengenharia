'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
function screen(response){
 const handlers={};const notices=[];let body;
 const elements={formRecuperar:{addEventListener:(event,fn)=>handlers[event]=fn,reset:()=>{}},documento:{value:'12.345.678/0001-90',addEventListener:()=>{}},btnRecuperar:{disabled:false,textContent:''}};
 const sandbox={document:{getElementById:id=>elements[id]},ITRAuth:{alerta:(_id,text,success)=>notices.push({text,success})},ITR:{jsonSeguro:async()=>response.data},fetch:async(_url,args)=>{body=JSON.parse(args.body);return response;}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/assets/js/recuperar-senha.js'),'utf8'),sandbox);
 return {submit:()=>handlers.submit({preventDefault(){}}),notices,elements,getBody:()=>body};
}
test('recuperação envia só CNPJ e orienta a conferir entrada/spam sem prometer entrega',async()=>{
 const ui=screen({ok:true,status:202,data:{sucesso:true}});await ui.submit();
 assert.deepEqual(ui.getBody(),{documento:'12345678000190'});const notice=ui.notices.at(-1);assert.equal(notice.success,true);assert.match(notice.text,/caixa de entrada.*spam/);assert.match(notice.text,/Se o CNPJ/);assert.match(notice.text,/senha atual continua a mesma/);assert.equal(ui.elements.btnRecuperar.disabled,false);
});
test('recuperação exibe limite de tentativas e permite tentar depois',async()=>{
 const ui=screen({ok:false,status:429,data:{erro:'Aguarde alguns minutos.'}});await ui.submit();assert.equal(ui.notices.at(-1).success,false);assert.match(ui.notices.at(-1).text,/Aguarde/);assert.equal(ui.elements.btnRecuperar.disabled,false);assert.equal(ui.elements.btnRecuperar.textContent,'Enviar dados de acesso');
});
