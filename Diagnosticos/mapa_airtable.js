/* =======================================================================
   mapa_airtable.js  —  RAIO-X COMPLETO DA BASE AIRTABLE DA ITR ENGENHARIA
   -----------------------------------------------------------------------
   O QUE ELE FAZ (e NÃO faz):
     - SÓ LÊ. Nunca escreve, nunca altera, nunca apaga nada no Airtable.
     - Descobre TODAS as tabelas da base automaticamente (via Metadata API)
       e, se isso falhar, cai numa lista conhecida do projeto.
     - Para cada tabela: lista TODOS os campos que aparecem, detecta o "tipo"
       de cada um (texto, numero, data, array, anexo, link, objeto...) e
       coleta ATE 5 REGISTROS REAIS de exemplo por campo.
     - Marca campos que vem vazios em parte dos registros (inconsistencia).
     - CHECAGEM DE ISOLAMENTO: conta quantos trabalhos da Geodeep tem o
       "ID Trabalho" vazio ou fora do padrao "GEODEEP_..." (os que poderiam
       "sumir" da visao do cliente). Liga direto na regra de isolamento.
     - Salva TUDO em dois arquivos na mesma pasta:
          mapa_airtable.txt   (legivel, para a gente conversar)
          mapa_airtable.json  (completo, estruturado, backup)

   SEGURANCA (embutida, sem voce pedir):
     - NUNCA imprime nem salva o TOKEN/segredos. Le do .env e pronto.
     - MASCARA CNPJ por padrao (mostra so inicio e fim). Para ver inteiro,
       rode com:  node mapa_airtable.js --cnpj-inteiro

   COMO RODAR:
     1) Salve este arquivo na MESMA pasta do seu airtable.js
     2) No Git Bash, dentro da pasta:   node mapa_airtable.js
     3) Abra a pasta, pegue mapa_airtable.txt + mapa_airtable.json e me mande.

   Pode demorar (varre tudo de proposito). Tudo bem, e o esperado.
   ======================================================================= */

'use strict';

const fs   = require('fs');
const path = require('path');
require('dotenv').config();

// ---------- 0) Checagem de ambiente (Node + fetch) ----------------------
(function checarAmbiente() {
  const versao = process.versions.node;
  const maior  = parseInt(versao.split('.')[0], 10);
  if (typeof fetch !== 'function') {
    console.error(
      '\n[ERRO] Seu Node (v' + versao + ') nao tem "fetch" nativo.\n' +
      'O fetch nativo existe a partir do Node 17.5+. Atualize o Node\n' +
      '(recomendado: 18, 20 ou mais novo) e rode de novo.\n'
    );
    process.exit(1);
  }
  console.log('Node v' + versao + ' OK (fetch nativo disponivel).' +
              (maior < 18 ? '  [aviso: versao antiga, considere atualizar]' : ''));
})();

// ---------- 1) Credenciais (lidas do .env, NUNCA impressas) -------------
const TOKEN =
  process.env.AIRTABLE_TOKEN ||
  process.env.AIRTABLE_API_KEY ||
  process.env.AIRTABLE_PAT;
const BASE_ID =
  process.env.AIRTABLE_BASE_ID ||
  process.env.BASE_ID;

if (!TOKEN || !BASE_ID) {
  console.error(
    '\n[ERRO] Faltou AIRTABLE_TOKEN e/ou AIRTABLE_BASE_ID no seu .env.\n' +
    'Confira se o arquivo .env esta nesta pasta e tem essas chaves.\n'
  );
  process.exit(1);
}

// ---------- 2) Opcoes de linha de comando -------------------------------
const MOSTRAR_CNPJ_INTEIRO = process.argv.includes('--cnpj-inteiro');
const EXEMPLOS_POR_CAMPO   = 5;   // quantos valores reais de exemplo por campo
const REGISTROS_VARRER     = 800; // teto de registros lidos por tabela (paginado)

// Cliente de teste cujo isolamento vamos auditar (Geodeep, do documento)
const GEODEEP_REC      = 'rectEDZrt5unCtR4Z';
const GEODEEP_PREFIXO  = 'GEODEEP_';
const TBL_NOVOS_TRAB   = 'tblJAP4Av9sWm8SmL'; // "Novos Trabalhos"

// Lista de tabelas conhecidas (fallback, caso a Metadata API nao responda).
// IDs/nomes confirmados no documento-mestre do projeto.
const TABELAS_FALLBACK = [
  { id: 'tblkQxQ6q7cBKXZ3C', nome: 'Clientes' },
  { id: 'tblJAP4Av9sWm8SmL', nome: 'Novos Trabalhos' },
  { id: 'tblYtVM2crMxpxHgG', nome: 'Ensaios' },
  { id: 'Ordem de Serviço',  nome: 'Ordem de Serviço' },
  { id: 'Amostras',          nome: 'Amostras' },
  { id: 'Trabalhos',         nome: 'Trabalhos (ANTIGA)' },
  { id: 'Usuário',           nome: 'Usuário' },
  { id: 'Dados Brutos',      nome: 'Dados Brutos' }
];

const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`;
const META_URL = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`;
const H = { headers: { Authorization: `Bearer ${TOKEN}` } };

// ---------- 3) Utilitarios ----------------------------------------------
const dorme = (ms) => new Promise(r => setTimeout(r, ms));

async function get(url, tentativas = 4) {
  for (let i = 1; i <= tentativas; i++) {
    const r = await fetch(url, H);
    if (r.status === 429) { // rate limit do Airtable: espera e tenta de novo
      await dorme(1200 * i);
      continue;
    }
    if (!r.ok) {
      const corpo = await r.text().catch(() => '');
      throw new Error(`${r.status} ${r.statusText} ${corpo.slice(0, 200)}`);
    }
    return r.json();
  }
  throw new Error('Falhou apos varias tentativas (rate limit?).');
}

// Detecta um "tipo" legivel para o valor de um campo
function tipoDe(v) {
  if (v === null || v === undefined) return 'vazio';
  if (Array.isArray(v)) {
    if (v.length === 0) return 'array(vazio)';
    const t0 = tipoDe(v[0]);
    return `array<${t0}>[${v.length}]`;
  }
  if (typeof v === 'object') {
    // anexo do Airtable tem url+filename; link tem id "rec..."
    if (v.url && v.filename) return 'anexo';
    if (v.id && String(v.id).startsWith('rec')) return 'link(rec)';
    return 'objeto';
  }
  if (typeof v === 'number')  return 'numero';
  if (typeof v === 'boolean') return 'booleano';
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) return 'data(ISO)';
    if (/^rec[A-Za-z0-9]{14}$/.test(v))    return 'link(rec)';
    return 'texto';
  }
  return typeof v;
}

// Mascara CNPJ/CPF dentro de um texto (a menos que --cnpj-inteiro)
function mascarar(valor, nomeCampo) {
  if (MOSTRAR_CNPJ_INTEIRO) return valor;
  const ehDoc = /cnpj|cpf|documento/i.test(nomeCampo || '');
  if (!ehDoc) return valor;
  const s = String(valor);
  const so = s.replace(/\D/g, '');
  if (so.length < 6) return valor;
  return so.slice(0, 2) + '.***.***/****-' + so.slice(-2) + '  (mascarado)';
}

// Resume um valor para caber numa linha de exemplo
function resumir(v, nomeCampo) {
  if (v === null || v === undefined) return '(vazio)';
  if (Array.isArray(v)) {
    return '[' + v.map(x => resumir(x, nomeCampo)).join(' | ') + ']';
  }
  if (typeof v === 'object') {
    if (v.url && v.filename) {
      return `ANEXO{nome:"${v.filename}", tipo:"${v.type || '?'}", url:(omitida)}`;
    }
    if (v.id) return `LINK{${v.id}}`;
    const j = JSON.stringify(v);
    return j.length > 160 ? j.slice(0, 160) + '…' : j;
  }
  let s = String(v);
  s = mascarar(s, nomeCampo);
  return s.length > 160 ? s.slice(0, 160) + '…' : s;
}

// ---------- 4) Descobrir tabelas (Metadata API, com fallback) -----------
async function descobrirTabelas() {
  try {
    const meta = await get(META_URL);
    if (meta && Array.isArray(meta.tables) && meta.tables.length) {
      console.log(`Metadata API OK: ${meta.tables.length} tabelas encontradas.`);
      return meta.tables.map(t => ({
        id: t.id,
        nome: t.name,
        // a Metadata API ja entrega o schema dos campos (bonus!)
        camposSchema: (t.fields || []).map(f => ({ nome: f.name, tipo: f.type }))
      }));
    }
  } catch (e) {
    console.log('Metadata API indisponivel (' + e.message +
                '). Usando lista conhecida do projeto.');
  }
  return TABELAS_FALLBACK.map(t => ({ ...t, camposSchema: null }));
}

// ---------- 5) Varrer uma tabela (paginado) -----------------------------
async function varrerTabela(tabela) {
  const idParaUrl = encodeURIComponent(tabela.id);
  let registros = [];
  let offset = null;
  let paginas = 0;

  do {
    let url = `${BASE_URL}/${idParaUrl}?pageSize=100`;
    if (offset) url += `&offset=${encodeURIComponent(offset)}`;
    let d;
    try {
      d = await get(url);
    } catch (e) {
      return { erro: e.message, registros: [] };
    }
    registros = registros.concat(d.records || []);
    offset = d.offset || null;
    paginas++;
    await dorme(220); // gentil com o rate limit (5 req/s do Airtable)
  } while (offset && registros.length < REGISTROS_VARRER);

  return { erro: null, registros, paginas };
}

// Monta o "perfil" dos campos de uma tabela a partir dos registros lidos
function perfilarCampos(registros) {
  const campos = {}; // nome -> { tipos:Set, preenchidos, exemplos:[] }
  const total = registros.length;

  registros.forEach(rec => {
    const f = rec.fields || {};
    Object.keys(f).forEach(nome => {
      if (!campos[nome]) campos[nome] = { tipos: {}, preenchidos: 0, exemplos: [] };
      const v = f[nome];
      const t = tipoDe(v);
      campos[nome].tipos[t] = (campos[nome].tipos[t] || 0) + 1;
      const vazio = (v === null || v === undefined ||
                     (Array.isArray(v) && v.length === 0) ||
                     (typeof v === 'string' && v.trim() === ''));
      if (!vazio) campos[nome].preenchidos++;
      if (campos[nome].exemplos.length < EXEMPLOS_POR_CAMPO && !vazio) {
        campos[nome].exemplos.push(resumir(v, nome));
      }
    });
  });

  // ordena campos por nome para leitura estavel
  const ordenado = {};
  Object.keys(campos).sort().forEach(k => {
    const c = campos[k];
    ordenado[k] = {
      tipos: c.tipos,
      preenchidos: c.preenchidos,
      total,
      faltando: total - c.preenchidos,
      exemplos: c.exemplos
    };
  });
  return ordenado;
}

// ---------- 6) Checagem de isolamento da Geodeep -----------------------
function auditarIsolamento(registrosNovosTrab) {
  let daGeodeepPorCliente = 0;     // tem o rec da Geodeep no campo Cliente
  let comPrefixoOk = 0;            // ID Trabalho comeca com GEODEEP_
  let semIdTrabalho = 0;           // ID Trabalho vazio
  let prefixoForaDoPadrao = 0;     // tem ID Trabalho mas nao comeca com GEODEEP_
  const exemplosForaDoPadrao = [];

  registrosNovosTrab.forEach(rec => {
    const f = rec.fields || {};
    const cli = JSON.stringify(f['Cliente'] || '');
    const ehGeodeep = cli.includes(GEODEEP_REC);
    if (!ehGeodeep) return;
    daGeodeepPorCliente++;

    const idTrab = f['ID Trabalho'];
    if (idTrab === null || idTrab === undefined || String(idTrab).trim() === '') {
      semIdTrabalho++;
    } else if (String(idTrab).startsWith(GEODEEP_PREFIXO)) {
      comPrefixoOk++;
    } else {
      prefixoForaDoPadrao++;
      if (exemplosForaDoPadrao.length < 10) {
        exemplosForaDoPadrao.push(String(idTrab).slice(0, 80));
      }
    }
  });

  return {
    daGeodeepPorCliente,
    comPrefixoOk,
    semIdTrabalho,
    prefixoForaDoPadrao,
    exemplosForaDoPadrao
  };
}

// ---------- 7) Programa principal ---------------------------------------
(async () => {
  const inicio = Date.now();
  const linhas = [];           // linhas do .txt
  const dump   = { gerado_em: new Date().toISOString(), base_id: '(omitido)', tabelas: {} };

  const L = (s = '') => { linhas.push(s); };
  const sep = () => L('-'.repeat(72));

  L('========================================================================');
  L('  RAIO-X DA BASE AIRTABLE — ITR ENGENHARIA');
  L('  Gerado em: ' + new Date().toLocaleString('pt-BR'));
  L('  (SOMENTE LEITURA — nada foi alterado no Airtable)');
  L('  CNPJ/CPF: ' + (MOSTRAR_CNPJ_INTEIRO ? 'INTEIRO (--cnpj-inteiro)' : 'MASCARADO'));
  L('========================================================================');
  L('');

  const tabelas = await descobrirTabelas();
  L(`Tabelas a varrer: ${tabelas.length}`);
  tabelas.forEach((t, i) => L(`   ${i + 1}. ${t.nome}   [${t.id}]`));
  L('');

  let registrosNovosTrab = null;

  for (const tabela of tabelas) {
    console.log(`Varrendo: ${tabela.nome} ...`);
    sep();
    L('TABELA: ' + tabela.nome + '   [' + tabela.id + ']');
    sep();

    const r = await varrerTabela(tabela);
    if (r.erro) {
      L('  [ERRO ao ler esta tabela] ' + r.erro);
      L('');
      dump.tabelas[tabela.nome] = { id: tabela.id, erro: r.erro };
      continue;
    }

    const total = r.registros.length;
    L(`  Registros lidos: ${total}` +
      (total >= REGISTROS_VARRER ? `  (limitado a ${REGISTROS_VARRER})` : '') +
      `   |  paginas: ${r.paginas}`);

    // guarda os registros de Novos Trabalhos para a auditoria de isolamento
    if (tabela.id === TBL_NOVOS_TRAB || /novos trabalhos/i.test(tabela.nome)) {
      registrosNovosTrab = r.registros;
    }

    // Se a Metadata API trouxe o schema, mostramos o tipo "oficial" do campo
    if (tabela.camposSchema) {
      L('  Schema oficial (Metadata API):');
      tabela.camposSchema.forEach(f => L(`     - ${f.nome}  <${f.tipo}>`));
    }

    const perfil = perfilarCampos(r.registros);
    const nomesCampos = Object.keys(perfil);
    L(`  Campos observados nos dados: ${nomesCampos.length}`);
    L('');

    nomesCampos.forEach(nome => {
      const c = perfil[nome];
      const tiposTxt = Object.entries(c.tipos)
        .map(([t, n]) => `${t}×${n}`).join(', ');
      L(`  • CAMPO: "${nome}"`);
      L(`      tipos vistos : ${tiposTxt}`);
      L(`      preenchimento: ${c.preenchidos}/${c.total}` +
        (c.faltando > 0 ? `   (VAZIO em ${c.faltando})` : '   (sempre preenchido)'));
      if (c.exemplos.length) {
        L('      exemplos reais:');
        c.exemplos.forEach((ex, i) => L(`         ${i + 1}) ${ex}`));
      } else {
        L('      exemplos reais: (nenhum valor preenchido encontrado)');
      }
      L('');
    });

    dump.tabelas[tabela.nome] = {
      id: tabela.id,
      registros_lidos: total,
      schema_oficial: tabela.camposSchema || null,
      campos: perfil
    };
  }

  // ---------- Auditoria de isolamento ----------
  sep();
  L('AUDITORIA DE ISOLAMENTO — CLIENTE GEODEEP (' + GEODEEP_REC + ')');
  sep();
  if (registrosNovosTrab) {
    const a = auditarIsolamento(registrosNovosTrab);
    L(`  Trabalhos da Geodeep (pelo campo "Cliente"): ${a.daGeodeepPorCliente}`);
    L(`  Com "ID Trabalho" comecando em "GEODEEP_": ${a.comPrefixoOk}`);
    L(`  SEM "ID Trabalho" (vazio): ${a.semIdTrabalho}`);
    L(`  Com "ID Trabalho" FORA do padrao GEODEEP_: ${a.prefixoForaDoPadrao}`);
    if (a.exemplosForaDoPadrao.length) {
      L('  Exemplos fora do padrao (estes "sumiriam" do filtro atual):');
      a.exemplosForaDoPadrao.forEach((ex, i) => L(`     ${i + 1}) ${ex}`));
    }
    L('');
    L('  LEITURA: se "SEM ID Trabalho" ou "FORA do padrao" forem > 0, entao');
    L('  o filtro de isolamento atual (que usa o prefixo do ID Trabalho)');
    L('  estaria ESCONDENDO trabalhos reais da Geodeep. Isso explicaria');
    L('  dados faltando — e precisamos trocar a regra para filtrar pelo');
    L('  campo "Cliente" (rec), que e mais confiavel.');
    dump.auditoria_isolamento_geodeep = a;
  } else {
    L('  [aviso] Nao consegui ler "Novos Trabalhos" para auditar.');
    dump.auditoria_isolamento_geodeep = null;
  }
  L('');

  const seg = ((Date.now() - inicio) / 1000).toFixed(1);
  L('========================================================================');
  L(`  FIM. Tempo total: ${seg}s`);
  L('========================================================================');

  // ---------- Salvar arquivos ----------
  const txtPath  = path.join(process.cwd(), 'mapa_airtable.txt');
  const jsonPath = path.join(process.cwd(), 'mapa_airtable.json');
  fs.writeFileSync(txtPath, linhas.join('\n'), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(dump, null, 2), 'utf8');

  console.log('\n=========================================================');
  console.log('PRONTO! Tempo: ' + seg + 's');
  console.log('Gerados nesta pasta:');
  console.log('   - mapa_airtable.txt   (legivel — me mande este)');
  console.log('   - mapa_airtable.json  (completo — me mande tambem)');
  console.log('Abra a pasta, anexe os dois aqui no chat e seguimos.');
  console.log('=========================================================\n');
})().catch(e => {
  console.error('\n[ERRO FATAL] ' + e.message + '\n');
  process.exit(1);
}); 