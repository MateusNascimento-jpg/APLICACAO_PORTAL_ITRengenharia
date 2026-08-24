'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const originalFiles=['original-login.css','original-portal.css','original-painel.css','original-como-funciona.css'];
test('folhas visuais do design original estão presentes',()=>{ for(const f of originalFiles) assert.ok(fs.existsSync(path.join(root,'public','assets','css',f)),f); });
test('páginas principais usam exclusivamente suas folhas visuais originais',()=>{ for(const p of ['login','portal','painel','como-funciona']){ const h=fs.readFileSync(path.join(root,'public',p+'.html'),'utf8'); assert.match(h,new RegExp('original-'+p.replace('como-funciona','como-funciona')+'\\.css')); assert.doesNotMatch(h,/itr-enterprise|base-(?:login|portal|painel|como-funciona)/); }});
