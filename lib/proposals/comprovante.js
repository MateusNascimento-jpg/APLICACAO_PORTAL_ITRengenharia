'use strict';

// Gerador PDF A4 autônomo: nenhuma dependência/binário adicional no servidor.
// Trata este documento como EVIDÊNCIA DO ACEITE, não como assinatura certificada.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const LOGO = fs.readFileSync(path.join(__dirname, 'assets/logo.jpg'));

const ITR = Object.freeze([
    ['Razão Social', 'ITR ENGENHARIA E CONSULTORIA LTDA'],
    ['Nome Fantasia', 'ITR ENGENHARIA E CONSULTORIA'],
    ['CNPJ', '43.736.713/0001-20'],
    ['Inscrição Estadual', '0808786200185'],
    ['Endereço completo', 'SCIA QUADRA 14 CONJUNTO 6 – Lote 5, Parte A'],
    ['CEP', '71250-130'],
    ['Cidade/UF', 'Brasília – DF'],
    ['E-mail para faturamento', 'comercial@itr.eng.br'],
    ['Telefone / WhatsApp', '61 99564-8450'],
    ['Responsável comercial', 'Vinícius S. Levay'],
]);

function pdfString(value) {
    // Helvetica usa WinAnsi (Windows-1252). Evitar depender de fontes externas.
    const out = [];
    for (const c of String(value ?? '').normalize('NFC')) {
        const u = c.codePointAt(0);
        const special = { 0x2013:150, 0x2014:151, 0x2018:145, 0x2019:146,
            0x201c:147, 0x201d:148, 0x2022:149, 0x20ac:128 };
        const code = u >= 32 && u <= 255 ? u : special[u] || 63;
        if ([40,41,92].includes(code)) out.push(92);
        out.push(code);
    }
    return Buffer.from(out).toString('binary');
}
function textWidthApprox(t, size, bold = false) {
    return [...String(t)].reduce((sum,c)=>sum+(c===' '?.28:/[ilI.,:;]/.test(c)?.25:/[MW@]/.test(c)?.85:(bold?.58:.52))*size,0);
}
function lines(text, size, width, max = 20) {
    const paragraphs = String(text ?? '—').replace(/\r/g,'').split('\n');
    const result = [];
    for (const paragraph of paragraphs) {
        const words = paragraph.split(/\s+/).filter(Boolean);
        let row = '';
        for (let word of words) {
            // String values can contain unusually long tokens or filenames.
            while (textWidthApprox(word,size)>width) {
                let n=1;
                while(n<word.length && textWidthApprox(word.slice(0,n+1),size)<width)n++;
                if(row){result.push(row);row='';}
                result.push(word.slice(0,n)); word=word.slice(n);
            }
            const joined = row ? row+' '+word : word;
            if (textWidthApprox(joined,size)>width && row) {result.push(row);row=word;}
            else row=joined;
        }
        result.push(row);
    }
    return result.slice(0,max);
}
function pdfObjects(parts) {
    const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n','binary')];
    const offsets = [0];
    let offset=chunks[0].length;
    for(let i=0;i<parts.length;i++) {
        offsets.push(offset);
        const head=Buffer.from(`${i+1} 0 obj\n`,'binary');
        const body=Buffer.isBuffer(parts[i])?parts[i]:Buffer.from(parts[i],'binary');
        const tail=Buffer.from('\nendobj\n','binary');
        chunks.push(head,body,tail);offset+=head.length+body.length+tail.length;
    }
    const start=offset;
    let xref=`xref\n0 ${parts.length+1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach(p=>{xref+=`${String(p).padStart(10,'0')} 00000 n \n`;});
    xref+=`trailer\n<< /Size ${parts.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
    chunks.push(Buffer.from(xref,'binary'));
    return Buffer.concat(chunks);
}
function generate({ proposal, version, pdfHash, acceptedAt, origin, attachmentId }) {
    if (!/^rec[A-Za-z0-9]{14}$/.test(proposal?.id||'') || !/^att[A-Za-z0-9]{14}$/.test(attachmentId||'') ||
        !/^[0-9a-f]{64}$/.test(pdfHash||'') || !/^[0-9a-f]{64}$/.test(version||'')) throw new Error('COMPROVANTE_INPUT_INVALID');
    const base = new URL(origin);
    if (base.protocol!=='https:' || base.username||base.password||base.pathname!=='/' || base.search||base.hash) throw new Error('COMPROVANTE_ORIGIN_INVALID');
    const proposalUrl=`${base.origin}/api/propostas/${proposal.id}/proposta-aceita`;
    const comprovanteUrl=`${base.origin}/api/propostas/${proposal.id}/comprovante`;
    const pages=[];
    let ops=[], annots=[], y=730;
    const blue=[.02,.36,.84], ink=[.09,.14,.20], grey=[.38,.46,.55], label=[.22,.29,.38];
    function fill(c){return `${c.join(' ')} rg`;}
    function box(x,yy,w,h,color){ops.push('q',fill(color),`${x} ${yy} ${w} ${h} re f`,'Q');}
    // Retângulo de cantos arredondados (pílula), desenhado com curvas Bézier.
    function pill(x,yy,w,h,color){const r=h/2,k=r*.5523;
        ops.push('q',fill(color),`${x+r} ${yy} m ${x+w-r} ${yy} l`,
            `${x+w-r+k} ${yy} ${x+w} ${yy+r-k} ${x+w} ${yy+r} c`,`${x+w} ${yy+r+k} ${x+w-r+k} ${yy+h} ${x+w-r} ${yy+h} c`,
            `${x+r} ${yy+h} l`,`${x+r-k} ${yy+h} ${x} ${yy+r+k} ${x} ${yy+r} c`,`${x} ${yy+r-k} ${x+r-k} ${yy} ${x+r} ${yy} c`,'f','Q');}
    function show(t,x,yy,size=10,bold=false,color=ink){
        ops.push('BT',`/F${bold?2:1} ${size} Tf`,fill(color),`${x} ${yy} Td (${pdfString(t)}) Tj`,'ET');
    }
    function header(){
        box(0,832,595,10,blue);
        ops.push('q','152 0 0 54 41 754 cm','/Im1 Do','Q');
        show('Portal ITR Engenharia',432,799,10,true,blue);
        show('Documento eletrônico de registro',417,785,8,false,grey);
        box(40,738,515,1,[.82,.86,.91]);
        y=720;
    }
    function footer(){
        box(40,73,515,1,[.85,.89,.94]);
        show('ITR Engenharia  •  Brasília / DF',41,58,8,true,blue);
        show('Documento emitido eletronicamente pelo Portal ITR Engenharia',285,58,7,false,grey);
        show('Esta versão registra o aceite; não constitui assinatura digital certificada.',40,42,7,false,grey);
    }
    function start(){ops=[];annots=[];header();}
    function finish(){footer();pages.push({commands:Buffer.from(ops.join('\n')+'\n','binary'),annots});}
    function enough(n){if(y-n<105){finish();start();}}
    function title(t){enough(55);show(t,41,y,20,true,blue);y-=31;}
    function heading(t){enough(45);box(41,y-26,513,31,[.922,.951,.98]);box(41,y-26,4,31,blue);show(t,53,y-15,11.5,true,blue);y-=43;}
    function para(t, opts={}){const size=opts.size||10;const indent=opts.indent||42;const maxW=opts.maxW||508;
        for(const part of lines(t,size,maxW,80)) {enough(size+6);show(part,indent,y,size,Boolean(opts.bold),opts.color||ink);y-=size+6;}
        y-=opts.after??7;}
    // Seção curta indivisível: título e texto ficam sempre na mesma página.
    function section(t,text,opts={}){const size=opts.size||10;
        enough(43+lines(text,size,opts.maxW||508,80).length*(size+6)+(opts.after??7));
        heading(t);para(text,opts);}
    let pairIndex=0;
    function pair(k,v){
        const rotulo=String(k);const value=String(v??'—');
        const wrapped=lines(value,9.5,315,20);
        const height=Math.max(30,wrapped.length*15+15);
        enough(height);
        if((pairIndex++ % 2)===0) box(41,y-height+7,513,height+1,[.97,.98,.991]);
        show(rotulo+':',50,y-8,9.2,true,label);
        let yy=y-8;
        for(const line of wrapped){show(line,233,yy,9.5,false,ink);yy-=15;}
        y-=height;
    }
    const cnpj=/^\d{14}$/.test(String(proposal.cnpj||''))
        ? String(proposal.cnpj).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5') : proposal.cnpj;
    // Sem valor confiável não se imprime "R$ 0,00".
    const valor=typeof proposal.valor==='number'&&Number.isFinite(proposal.valor)&&proposal.valor>=0
        ? new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(proposal.valor) : 'Conforme proposta';
    start();
    // Selo à direita do título, como no modelo institucional de comprovante.
    pill(435,y-6,119,22,[.906,.937,.992]);
    show('Condições comerciais',447,y+1,9,true,blue);
    title('Comprovante de contrato comercial');
    box(41,y-28,513,43,blue);
    show('ACEITE DE PROPOSTA REGISTRADO',55,y-2,12,true,[1,1,1]);
    const when=new Date(acceptedAt);
    const date=Number.isNaN(+when)?'Data em conferência':when.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
    show(`Registrado em ${date}`,55,y-20,9,false,[1,1,1]);
    y-=65;
    heading('Resumo de Contrato');
    pair('Empresa contratante',String(proposal.nomeCliente||'Cliente').slice(0,200));
    pair('CNPJ do cliente',cnpj);
    if (proposal.emailContato) pair('Contato por e-mail',String(proposal.emailContato).slice(0,300));
    pair('Proposta comercial',proposal.numero);
    pair('Valor total',valor);
    pair('Condição de pagamento',String(proposal.formaPagamento||'Conforme proposta').slice(0,300));
    pair('Prazo para pagamento',proposal.prazoPagamentoDias==null?'Conforme proposta':`${proposal.prazoPagamentoDias} dias após a emissão da respectiva nota fiscal`);
    section('Condições comerciais','Este documento comprova o registro do aceite da proposta comercial identificada acima. A formalização do contrato e as demais etapas seguem os procedimentos da ITR Engenharia.');
    if(proposal.descricao) {heading('Descrição dos serviços');para(String(proposal.descricao).slice(0,2500));}
    section('Acompanhamento','Acesse o Portal do Cliente para acompanhar integralmente os processos, ensaios e procedimentos relativos às suas amostras.');
    section('Atenção','Este comprovante registra uma confirmação eletrônica de aceite vinculada à versão identificada da proposta. Não substitui o documento comercial original, nem representa assinatura eletrônica certificada.',{size:9.3});
    // Os dados da ITR são um bloco institucional único; não dividir
    // o título e a identificação legal entre páginas do comprovante.
    const institutionalHeight=45+ITR.reduce((height,[,value])=>
        height+Math.max(30,lines(String(value),9.5,315,20).length*15+15),0)+25;
    enough(institutionalHeight);
    heading('Dados institucionais da ITR Engenharia');
    for(const [k,v] of ITR) pair(k,v);
    // Documentos associados à decisão: dois CTAs PDF, visualmente alinhados
    // e com hiperligações autenticadas. Os hashes continuam gravados no MySQL;
    // remover a exibição das sequências longas não remove a checagem criptográfica.
    // Não incorporar arquivos à evidência: o PDF original permanece imutável.
    enough(43+58+12);
    heading('Integridade do aceite (pdf da proposta)');
    function pdfButton(x, top, w, text, uri) {
        const h=49, bottom=top-h;
        box(x,bottom,w,h,[.961,.976,.997]);
        ops.push('q',`${blue.join(' ')} RG`,'0.8 w',`${x} ${bottom} ${w} ${h} re S`,'Q');
        box(x+12,bottom+12,29,25,blue);
        show('PDF',x+16,bottom+21,8,true,[1,1,1]);
        show(text,x+49,bottom+20,10,true,blue);
        annots.push({rect:[x,bottom,x+w,bottom+h],uri});
    }
    const buttonGap=13,buttonWidth=(513-buttonGap)/2;
    pdfButton(41,y,buttonWidth,'Proposta original',proposalUrl);
    pdfButton(41+buttonWidth+buttonGap,y,buttonWidth,'Comprovante',comprovanteUrl);
    y-=61;
    finish();
    // Build pages + fonts + JPEG XObject + hyperlink annotations.
    const count=pages.length;
    const firstPage=6;
    const imageObj=5;
    const font1=3,font2=4;
    const objs=[null,`<< /Type /Pages /Kids [${pages.map((_,i)=>`${firstPage+i*2} 0 R`).join(' ')}] /Count ${count} >>`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
        Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 560 /Height 200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${LOGO.length} >>\nstream\n`),LOGO,Buffer.from('\nendstream')])];
    // Correct image dimensions from the static asset header at build time: embed through known dimensions.
    const dim=require('./logo-metadata.json');
    objs[4]=Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${dim.width} /Height ${dim.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${LOGO.length} >>\nstream\n`),LOGO,Buffer.from('\nendstream')]);
    for (let i=0;i<count;i++) {
        const a=pages[i];
            objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> /XObject << /Im1 ${imageObj} 0 R >> >> /Contents ${firstPage+i*2+1} 0 R /Annots [${a.annots.map((_,j)=>`${firstPage+count*2+pages.slice(0,i).reduce((n,p)=>n+p.annots.length,0)+j} 0 R`).join(' ')}] >>`);
        objs.push(Buffer.concat([Buffer.from(`<< /Length ${a.commands.length} >>\nstream\n`),a.commands,Buffer.from('endstream')]));
    }
    for(const p of pages) for(const n of p.annots) {
        const safe=n.uri.replace(/[\\()]/g,x=>'\\'+x);
        objs.push(`<< /Type /Annot /Subtype /Link /Rect [${n.rect.join(' ')}] /Border [0 0 0] /A << /S /URI /URI (${safe}) >> >>`);
    }
    objs[0]='<< /Type /Catalog /Pages 2 0 R >>';
    const bytes=pdfObjects(objs);
    return {bytes,hash:crypto.createHash('sha256').update(bytes).digest('hex'),proposalUrl};
}
module.exports={generate,ITR,lines};
