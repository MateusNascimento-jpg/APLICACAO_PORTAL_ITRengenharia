/* =========================================================================
   FINANCEIRO — contratos e faturas (somente consulta)
   Usa somente /api/financeiro e o proxy autenticado de documentos. Nada aqui
   decide autorização: o servidor filtra por CNPJ e classifica as abas. Todo
   texto vindo da API entra no DOM por textContent (nunca innerHTML).
   Depende de portal.js: NAVEGACAO_ATUAL, ocultarViewsPortal, limparNavAtiva,
   ativarViewInicial e aplicarIcones.
   ========================================================================= */
(function () {
  'use strict';

  var painel = document.getElementById('painelFinanceiro');
  var nav = document.getElementById('navFinanceiro');
  if (!painel || !nav) return;

  // Sem cache de dados financeiros no navegador: cada abertura consulta a API.
  var TIMEOUT_MS = 30000;
  var TEXTO_PROCESSAMENTO = 'Sua proposta foi aceita. As informações do contrato e das respectivas faturas estarão disponíveis nesta área após o processamento comercial.';
  var TEXTO_ERRO = 'Não foi possível carregar suas informações financeiras. Tente novamente em instantes.';
  var TEXTO_INDISPONIVEL = 'As informações financeiras não estão disponíveis para esta conta.';
  var TEXTO_CONFERENCIA = 'Algumas informações financeiras estão em conferência pela ITR e aparecerão nesta área assim que forem confirmadas.';
  var TEXTO_SEM_FATURAS = 'Nenhuma fatura disponível no momento.';
  var ESTADOS = ['disponivel', 'conferencia', 'processamento', 'vazio'];
  var TEXTO_VAZIO = 'Nenhuma fatura nesta categoria.';
  var TEXTO_SEM_DOCUMENTOS = 'Ainda não há documentos anexados.';

  var STATUS = {
    AGUARDANDO: 'Aguardando Emissão da NF',
    A_VENCER: 'A Vencer',
    VENCIDO: 'Vencido',
    PAGO: 'Pago',
    CANCELADO: 'Cancelado'
  };
  var CLASSE_STATUS = {};
  CLASSE_STATUS[STATUS.AGUARDANDO] = 'aguardando';
  CLASSE_STATUS[STATUS.A_VENCER] = 'a-vencer';
  CLASSE_STATUS[STATUS.VENCIDO] = 'vencido';
  CLASSE_STATUS[STATUS.PAGO] = 'pago';
  CLASSE_STATUS[STATUS.CANCELADO] = 'cancelado';

  var ABAS = [
    { id: 'proximas', botao: 'finAbaProximas', total: 'finTotalProximas', nome: 'Próximas' },
    { id: 'a-pagar', botao: 'finAbaAPagar', total: 'finTotalAPagar', nome: 'A pagar' },
    { id: 'pagas', botao: 'finAbaPagas', total: 'finTotalPagas', nome: 'Pagas' },
    { id: 'canceladas', botao: 'finAbaCanceladas', total: 'finTotalCanceladas', nome: 'Canceladas' }
  ];

  // Colunas por aba (handoff 03). "valor" alinha à direita com algarismos tabulares.
  var COLUNAS = {
    'proximas': [
      { rotulo: 'Contrato', classe: 'contrato', valor: contratoDaFatura },
      { rotulo: 'Parcela', classe: 'parcela', valor: rotuloParcela },
      { rotulo: 'Valor da parcela', classe: 'valor', valor: function (f) { return moeda(f.valorParcela); }, numero: true },
      { rotulo: 'Prazo para pagamento', classe: 'data', valor: function (f) { return textoPrazo(f.prazoPagamentoDias, true); } },
      { rotulo: 'Situação', classe: 'situacao', selo: true }
    ],
    'a-pagar': [
      { rotulo: 'Contrato', classe: 'contrato', valor: contratoDaFatura },
      { rotulo: 'Parcela', classe: 'parcela', valor: rotuloParcela },
      { rotulo: 'Valor da parcela', classe: 'valor', valor: function (f) { return moeda(f.valorParcela); }, numero: true },
      { rotulo: 'Vencimento', classe: 'data', valor: textoVencimento },
      { rotulo: 'Situação', classe: 'situacao', selo: true }
    ],
    'pagas': [
      { rotulo: 'Contrato', classe: 'contrato', valor: contratoDaFatura },
      { rotulo: 'Parcela', classe: 'parcela', valor: rotuloParcela },
      { rotulo: 'Valor pago', classe: 'valor', valor: function (f) { return moeda(f.valorPago); }, numero: true },
      { rotulo: 'Data do pagamento', classe: 'data', valor: function (f) { return dataBR(f.dataPagamento) || '—'; } },
      { rotulo: 'Situação', classe: 'situacao', selo: true }
    ],
    // Canceladas é agrupada por contrato: o nome do contrato fica no cabeçalho do grupo.
    'canceladas': [
      { rotulo: 'Parcela', classe: 'parcela', valor: rotuloParcela },
      { rotulo: 'Valor informativo', classe: 'valor', valor: function (f) { return moeda(f.valorParcela); }, numero: true },
      { rotulo: 'Situação', classe: 'situacao', selo: true }
    ]
  };

  var estado = {
    dados: null,
    emVoo: null,
    aba: 'proximas',
    abaEscolhida: false,
    aberta: null,
    busca: ''
  };
  var contratosPorId = {};

  function $(id) { return document.getElementById(id); }

  /* ---- Formatação (pt-BR, BRL, datas de calendário sem fuso) ---- */
  var formatoMoeda = null;
  try { formatoMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch (_) {}
  function moeda(valor) {
    if (typeof valor !== 'number' || !isFinite(valor) || valor < 0) return '—';
    return formatoMoeda ? formatoMoeda.format(valor) : 'R$ ' + valor.toFixed(2).replace('.', ',');
  }
  function dataBR(iso) {
    var partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return partes ? partes[3] + '/' + partes[2] + '/' + partes[1] : null;
  }
  // Prazo é duração contratual (dias após a NF), nunca uma data de vencimento.
  function textoPrazo(dias, curto) {
    if (typeof dias !== 'number' || dias < 0 || dias % 1 !== 0) return '—';
    var sufixo = curto ? ' após a NF' : ' após emissão da NF';
    return (dias === 1 ? '1 dia' : dias + ' dias') + sufixo;
  }
  function textoVencimento(f) {
    var data = dataBR(f.vencimento);
    if (data) return data;
    if (f.status === STATUS.AGUARDANDO) return 'Definido após a emissão da NF';
    return 'Vencimento não informado';
  }
  function textoTamanho(bytes) {
    if (typeof bytes !== 'number' || !isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
  }
  function normalizarBusca(texto) {
    return String(texto == null ? '' : texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  /* ---- Rótulos derivados (sem inventar dados) ---- */
  function nomeContrato(contrato) {
    if (!contrato) return '—';
    if (contrato.nome) return contrato.nome;
    var numero = contrato.proposta && contrato.proposta.numero;
    return numero ? 'Contrato da proposta ' + numero : 'Contrato';
  }
  function contratoDaFatura(f) {
    return f.contratoNome || nomeContrato(contratosPorId[f.contratoId]);
  }
  // A fórmula "Parcela" do Airtable repete o contrato no início
  // ("C105-2026 - Parcela 1/3"). A coluna Contrato já mostra esse dado, então
  // só o prefixo idêntico é omitido; o texto original aparece nos detalhes.
  function rotuloParcela(f) {
    var texto = f.parcela || '';
    var prefixo = f.contratoNome ? f.contratoNome + ' - ' : '';
    if (prefixo && texto.indexOf(prefixo) === 0 && texto.length > prefixo.length) texto = texto.slice(prefixo.length);
    return texto || '—';
  }

  /* ---- Construção de DOM sem innerHTML para dados externos ---- */
  function el(tag, classe, texto) {
    var no = document.createElement(tag);
    if (classe) no.className = classe;
    if (texto != null) no.textContent = texto;
    return no;
  }
  function icone(nome) {
    var i = el('i', 'ti ti-' + nome);
    i.setAttribute('aria-hidden', 'true');
    return i;
  }
  function botao(classe, texto, acao) {
    var b = el('button', classe, texto);
    b.type = 'button';
    if (acao) b.setAttribute('data-acao', acao);
    return b;
  }
  function converterIcones(raiz) {
    if (typeof aplicarIcones === 'function') aplicarIcones(raiz);
  }

  function seloSituacao(f) {
    var caixa = el('span', 'financeiro-situacao');
    if (f.revisao) {
      caixa.appendChild(el('span', 'financeiro-selo revisao', 'Pendente de revisão'));
      caixa.appendChild(el('span', 'financeiro-situacao-nota', 'Status de origem: ' + (f.status || '—')));
      return caixa;
    }
    caixa.appendChild(el('span', 'financeiro-selo ' + (CLASSE_STATUS[f.status] || ''), f.status || '—'));
    var contrato = contratosPorId[f.contratoId];
    if (f.aba === 'canceladas' && f.status !== STATUS.CANCELADO && contrato && contrato.status === 'Cancelado') {
      caixa.appendChild(el('span', 'financeiro-situacao-nota', 'Contrato cancelado'));
    }
    return caixa;
  }

  /* ---- Documentos: somente o proxy autenticado, montado a partir de IDs ---- */
  var TIPOS_DOCUMENTO = { nfse: 'file-invoice', boleto: 'barcode', proposta: 'file-description' };
  function urlDocumento(doc) {
    if (!Object.prototype.hasOwnProperty.call(TIPOS_DOCUMENTO, doc.tipo)) return null;
    if (!/^rec[A-Za-z0-9]{14}$/.test(doc.registroId || '') || !/^att[A-Za-z0-9]{14}$/.test(doc.anexoId || '')) return null;
    return '/api/financeiro/documentos/' + encodeURIComponent(doc.tipo) + '/' + encodeURIComponent(doc.registroId) + '/' + encodeURIComponent(doc.anexoId);
  }
  function listaDocumentos(documentos) {
    var bloco = el('div', 'financeiro-documentos');
    bloco.appendChild(el('h3', 'financeiro-documentos-titulo', 'Documentos'));
    var validos = documentos.filter(function (doc) { return urlDocumento(doc); });
    if (!validos.length) {
      bloco.appendChild(el('p', 'financeiro-documentos-vazio', TEXTO_SEM_DOCUMENTOS));
      return bloco;
    }
    var lista = el('ul', 'financeiro-documentos-lista');
    validos.forEach(function (doc) {
      var item = el('li', 'financeiro-documento');
      var marca = el('span', 'financeiro-documento-icone');
      marca.appendChild(icone(TIPOS_DOCUMENTO[doc.tipo]));
      item.appendChild(marca);
      var textos = el('span', 'financeiro-documento-textos');
      textos.appendChild(el('strong', null, doc.rotulo || 'Documento'));
      var nome = el('span', 'financeiro-documento-nome', doc.nome || '');
      nome.title = doc.nome || '';
      textos.appendChild(nome);
      var tamanho = textoTamanho(doc.tamanho);
      if (tamanho) textos.appendChild(el('span', 'financeiro-documento-tamanho', tamanho));
      item.appendChild(textos);
      var link = el('a', 'financeiro-documento-acao');
      link.href = urlDocumento(doc);
      link.rel = 'noopener noreferrer';
      if (doc.visualizavel) {
        link.target = '_blank';
        link.appendChild(icone('external-link'));
        link.appendChild(document.createTextNode('Abrir'));
        link.setAttribute('aria-label', 'Abrir ' + (doc.rotulo || 'documento') + ': ' + (doc.nome || ''));
      } else {
        link.setAttribute('download', '');
        link.appendChild(icone('download'));
        link.appendChild(document.createTextNode('Baixar'));
        link.setAttribute('aria-label', 'Baixar ' + (doc.rotulo || 'documento') + ': ' + (doc.nome || ''));
      }
      item.appendChild(link);
      lista.appendChild(item);
    });
    bloco.appendChild(lista);
    return bloco;
  }

  /* ---- Detalhes expandidos (inline, sem modal) ---- */
  function itemDetalhe(grade, rotulo, valor, nota) {
    var item = el('div', 'financeiro-detalhe-item');
    item.appendChild(el('dt', null, rotulo));
    var dd = el('dd', null, valor);
    if (nota) dd.appendChild(el('span', 'financeiro-detalhe-nota', nota));
    item.appendChild(dd);
    grade.appendChild(item);
  }
  function camposContrato(grade, contrato) {
    itemDetalhe(grade, 'Contrato', nomeContrato(contrato));
    itemDetalhe(grade, 'Situação do contrato', (contrato && contrato.status) || '—');
    var numero = contrato && contrato.proposta && contrato.proposta.numero;
    itemDetalhe(grade, 'Proposta', numero ? 'Proposta ' + numero : '—');
    itemDetalhe(grade, 'Condição de pagamento', (contrato && contrato.proposta && contrato.proposta.formaPagamento) || '—');
  }
  function detalhesFatura(f) {
    var contrato = contratosPorId[f.contratoId];
    var caixa = el('div', 'financeiro-detalhe');
    if (f.revisao) {
      caixa.appendChild(el('p', 'financeiro-detalhe-alerta', 'Esta cobrança pertence a um contrato cancelado e está em revisão pela ITR. Por isso ela não aparece em “A pagar”.'));
    }
    var grade = el('dl', 'financeiro-detalhe-grade');
    itemDetalhe(grade, 'Identificação da parcela', f.parcela || '—');
    camposContrato(grade, contrato);
    itemDetalhe(grade, 'Prazo para pagamento', textoPrazo(f.prazoPagamentoDias));
    itemDetalhe(grade, 'Emissão da NF', dataBR(f.dataEmissaoNf) || (f.status === STATUS.AGUARDANDO ? 'Ainda não emitida' : '—'));
    itemDetalhe(grade, 'Vencimento', textoVencimento(f));
    itemDetalhe(grade, 'Valor da parcela', moeda(f.valorParcela));
    if (f.status === STATUS.PAGO || (typeof f.valorPago === 'number' && f.valorPago > 0)) {
      itemDetalhe(grade, 'Valor pago', moeda(f.valorPago));
    }
    if (f.dataPagamento) itemDetalhe(grade, 'Data do pagamento', dataBR(f.dataPagamento) || '—');
    if (typeof f.diferenca === 'number') {
      itemDetalhe(grade, 'Diferença calculada', moeda(f.diferenca), 'Valor da parcela menos o valor pago. Informativo: a situação oficial da fatura não muda.');
    }
    caixa.appendChild(grade);
    var documentos = (f.documentos || []).concat(contrato && contrato.documentos ? contrato.documentos : []);
    caixa.appendChild(listaDocumentos(documentos));
    return caixa;
  }
  function detalhesContrato(contrato) {
    var caixa = el('div', 'financeiro-detalhe');
    var grade = el('dl', 'financeiro-detalhe-grade');
    camposContrato(grade, contrato);
    itemDetalhe(grade, 'Prazo para pagamento', textoPrazo(contrato.prazoPagamentoDias));
    caixa.appendChild(grade);
    var pagas = (estado.dados.faturas || []).some(function (f) { return f.contratoId === contrato.id && f.aba === 'pagas'; });
    if (pagas) caixa.appendChild(el('p', 'financeiro-detalhe-nota-bloco', 'As parcelas pagas deste contrato continuam na aba “Pagas”.'));
    caixa.appendChild(listaDocumentos(contrato.documentos || []));
    return caixa;
  }

  /* ---- Filtros locais sobre o conjunto já autorizado pelo servidor ---- */
  function correspondeBusca(textos) {
    var termos = normalizarBusca(estado.busca).split(/\s+/).filter(Boolean);
    if (!termos.length) return true;
    var alvo = normalizarBusca(textos.join(' '));
    return termos.every(function (t) { return alvo.indexOf(t) >= 0; });
  }
  function textosFatura(f) {
    var contrato = contratosPorId[f.contratoId];
    return [f.contratoNome, f.parcela, contrato && contrato.proposta && contrato.proposta.numero];
  }
  function textosContrato(c) {
    return [c.nome, c.proposta && c.proposta.numero];
  }
  function faturasDaAba(aba) {
    return (estado.dados.faturas || []).filter(function (f) {
      return f.aba === aba && correspondeBusca(textosFatura(f));
    });
  }
  // Canceladas: agrupadas por contrato. Contrato cancelado aparece mesmo sem
  // parcelas nesta aba (histórico); parcelas pagas continuam em "Pagas".
  function gruposCanceladas() {
    var faturas = faturasDaAba('canceladas');
    var grupos = [];
    (estado.dados.contratos || []).forEach(function (c) {
      var doContrato = faturas.filter(function (f) { return f.contratoId === c.id; });
      var cancelado = c.status === 'Cancelado' && correspondeBusca(textosContrato(c));
      if (doContrato.length || cancelado) grupos.push({ contrato: c, faturas: doContrato });
    });
    return grupos;
  }
  function totalAba(aba) {
    if (aba !== 'canceladas') return faturasDaAba(aba).length;
    return gruposCanceladas().reduce(function (soma, g) { return soma + (g.faturas.length || 1); }, 0);
  }

  /* ---- Tabela ---- */
  function classeCelula(coluna) {
    return 'fin-c-' + coluna.classe + (coluna.numero ? ' financeiro-num' : '');
  }
  function celula(coluna, f) {
    var td = el('td', classeCelula(coluna));
    td.setAttribute('data-rotulo', coluna.rotulo);
    if (coluna.selo) td.appendChild(seloSituacao(f));
    else td.textContent = coluna.valor(f);
    return td;
  }
  function botaoDetalhes(id, rotulo) {
    var b = botao('financeiro-detalhes-btn', null, 'detalhes');
    b.setAttribute('aria-expanded', estado.aberta === id ? 'true' : 'false');
    b.setAttribute('aria-controls', 'fin-det-' + id);
    b.setAttribute('aria-label', 'Detalhes de ' + rotulo);
    b.setAttribute('data-id', id);
    b.appendChild(el('span', 'financeiro-detalhes-texto', 'Detalhes'));
    b.appendChild(icone('chevron-down'));
    return b;
  }
  function linhas(id, celulas, rotulo, conteudoDetalhe, totalColunas) {
    var aberta = estado.aberta === id;
    var tr = el('tr', 'financeiro-linha' + (aberta ? ' aberta' : ''));
    tr.setAttribute('data-id', id);
    celulas.forEach(function (td) { tr.appendChild(td); });
    var acao = el('td', 'financeiro-acao');
    acao.appendChild(botaoDetalhes(id, rotulo));
    tr.appendChild(acao);

    var trDetalhe = el('tr', 'financeiro-detalhe-linha');
    trDetalhe.id = 'fin-det-' + id;
    trDetalhe.hidden = !aberta;
    var td = el('td');
    td.colSpan = totalColunas + 1;
    td.appendChild(conteudoDetalhe);
    trDetalhe.appendChild(td);
    return [tr, trDetalhe];
  }
  function linhasFatura(f, colunas) {
    var celulas = colunas.map(function (coluna) { return celula(coluna, f); });
    var rotulo = contratoDaFatura(f) + ', ' + rotuloParcela(f);
    if (rotulo.length > 120) rotulo = rotulo.slice(0, 120);
    return linhas(f.id, celulas, rotulo, detalhesFatura(f), colunas.length);
  }
  function linhasContratoCancelado(contrato, colunas) {
    var celulas = colunas.map(function (coluna) {
      var td = el('td', classeCelula(coluna));
      td.setAttribute('data-rotulo', coluna.rotulo);
      if (coluna.classe === 'contrato') td.textContent = nomeContrato(contrato);
      else if (coluna.classe === 'parcela') td.textContent = 'Sem parcelas pendentes';
      else if (coluna.selo) td.appendChild(el('span', 'financeiro-selo cancelado', 'Contrato cancelado'));
      else td.textContent = '—';
      return td;
    });
    return linhas(contrato.id, celulas, nomeContrato(contrato), detalhesContrato(contrato), colunas.length);
  }
  function cabecalhoTabela(colunas) {
    var thead = el('thead');
    var tr = el('tr');
    colunas.forEach(function (coluna) {
      var th = el('th', coluna.numero ? 'financeiro-num' : null, coluna.rotulo);
      th.scope = 'col';
      tr.appendChild(th);
    });
    var acao = el('th', 'financeiro-acao');
    acao.scope = 'col';
    acao.appendChild(el('span', 'visualmente-oculto', 'Detalhes'));
    tr.appendChild(acao);
    thead.appendChild(tr);
    return thead;
  }
  function renderizarTabela() {
    var area = $('financeiroTabela');
    var aba = estado.aba;
    var colunas = COLUNAS[aba];
    var nomeAba = ABAS.filter(function (a) { return a.id === aba; })[0].nome;
    area.replaceChildren();
    area.setAttribute('aria-labelledby', ABAS.filter(function (a) { return a.id === aba; })[0].botao);

    var tabela = el('table', 'financeiro-tabela-dados financeiro-aba-' + aba);
    tabela.appendChild(el('caption', 'visualmente-oculto', 'Faturas — ' + nomeAba));
    tabela.appendChild(cabecalhoTabela(colunas));
    var vazio = true;

    if (aba === 'canceladas') {
      gruposCanceladas().forEach(function (grupo) {
        vazio = false;
        var tbody = el('tbody', 'financeiro-grupo');
        var cab = el('tr', 'financeiro-grupo-cabecalho');
        var th = el('th');
        th.scope = 'rowgroup';
        th.colSpan = colunas.length + 1;
        th.appendChild(el('span', 'financeiro-grupo-nome', nomeContrato(grupo.contrato)));
        th.appendChild(el('span', 'financeiro-grupo-status', 'Contrato: ' + (grupo.contrato.status || '—')));
        cab.appendChild(th);
        tbody.appendChild(cab);
        var conjunto = grupo.faturas.length
          ? grupo.faturas.map(function (f) { return linhasFatura(f, colunas); })
          : [linhasContratoCancelado(grupo.contrato, colunas)];
        conjunto.forEach(function (par) { tbody.appendChild(par[0]); tbody.appendChild(par[1]); });
        tabela.appendChild(tbody);
      });
    } else {
      var tbody = el('tbody');
      faturasDaAba(aba).forEach(function (f) {
        vazio = false;
        var par = linhasFatura(f, colunas);
        tbody.appendChild(par[0]);
        tbody.appendChild(par[1]);
      });
      tabela.appendChild(tbody);
    }

    if (vazio) {
      var texto = normalizarBusca(estado.busca) ? 'Nenhuma fatura encontrada para esta busca.' : TEXTO_VAZIO;
      area.appendChild(el('p', 'financeiro-vazio', texto));
    } else {
      area.appendChild(tabela);
    }
    converterIcones(area);
  }

  function alternarDetalhe(id) {
    var anterior = estado.aberta;
    estado.aberta = anterior === id ? null : id;
    var linhasTabela = Array.prototype.slice.call($('financeiroTabela').querySelectorAll('tr.financeiro-linha'));
    [anterior, estado.aberta].forEach(function (alvo) {
      if (!alvo) return;
      var linha = linhasTabela.filter(function (tr) { return tr.getAttribute('data-id') === alvo; })[0];
      var detalhe = $('fin-det-' + alvo);
      var aberto = estado.aberta === alvo;
      if (linha) {
        linha.classList.toggle('aberta', aberto);
        var b = linha.querySelector('.financeiro-detalhes-btn');
        if (b) b.setAttribute('aria-expanded', aberto ? 'true' : 'false');
      }
      if (detalhe) detalhe.hidden = !aberto;
    });
  }

  /* ---- Abas (WAI-ARIA tabs com ativação automática) ---- */
  function atualizarAbas() {
    ABAS.forEach(function (aba) {
      var b = $(aba.botao);
      var ativa = aba.id === estado.aba;
      b.setAttribute('aria-selected', ativa ? 'true' : 'false');
      b.tabIndex = ativa ? 0 : -1;
      b.classList.toggle('ativa', ativa);
      $(aba.total).textContent = String(totalAba(aba.id));
    });
  }
  function selecionarAba(id, focar) {
    if (!COLUNAS[id]) return;
    estado.aba = id;
    estado.abaEscolhida = true;
    estado.aberta = null;
    atualizarAbas();
    renderizarTabela();
    if (focar) $(ABAS.filter(function (a) { return a.id === id; })[0].botao).focus();
  }
  function abaInicial() {
    if (estado.abaEscolhida) return estado.aba;
    for (var i = 0; i < ABAS.length; i += 1) if (totalAba(ABAS[i].id) > 0) return ABAS[i].id;
    return 'proximas';
  }

  /* ---- Estados: carregando, processamento, erro, indisponível ---- */
  function ocultarConteudo() {
    ['financeiroBuscaCaixa', 'financeiroAvisos', 'financeiroAbas', 'financeiroTabela', 'financeiroAtualizado'].forEach(function (id) {
      $(id).hidden = true;
    });
    $('financeiroTabela').replaceChildren();
  }
  function mostrarEstado(conteudo, carregando) {
    var caixa = $('financeiroEstado');
    caixa.replaceChildren();
    caixa.classList.toggle('carregando', Boolean(carregando));
    caixa.appendChild(conteudo);
    caixa.hidden = false;
    converterIcones(caixa);
  }
  function mostrarCarregando() {
    ocultarConteudo();
    var bloco = el('div', 'financeiro-skeleton');
    bloco.appendChild(el('span', 'visualmente-oculto', 'Carregando informações financeiras…'));
    for (var i = 0; i < 4; i += 1) {
      var linha = el('div', 'financeiro-skeleton-linha');
      linha.setAttribute('aria-hidden', 'true');
      ['curta', 'media', 'curta', 'media', 'curta'].forEach(function (largura) {
        linha.appendChild(el('span', 'portal-skeleton-linha financeiro-skeleton-' + largura));
      });
      bloco.appendChild(linha);
    }
    mostrarEstado(bloco, true);
  }
  function mostrarMensagem(classe, nomeIcone, titulo, texto, rotuloBotao) {
    var bloco = el('div', 'financeiro-mensagem ' + classe);
    var marca = el('span', 'financeiro-mensagem-icone');
    marca.appendChild(icone(nomeIcone));
    bloco.appendChild(marca);
    var corpo = el('div', 'financeiro-mensagem-corpo');
    if (titulo) corpo.appendChild(el('h3', null, titulo));
    corpo.appendChild(el('p', null, texto));
    if (rotuloBotao) {
      var b = botao('btn-sec financeiro-recarregar', null, 'recarregar');
      b.appendChild(icone('refresh'));
      b.appendChild(document.createTextNode(rotuloBotao));
      corpo.appendChild(b);
    }
    bloco.appendChild(corpo);
    mostrarEstado(bloco, false);
  }
  function mostrarErro() {
    ocultarConteudo();
    mostrarMensagem('erro', 'wifi-off', null, TEXTO_ERRO, 'Tentar novamente');
  }
  function mostrarIndisponivel() {
    ocultarConteudo();
    mostrarMensagem('indisponivel', 'circle-x', null, TEXTO_INDISPONIVEL, null);
    if (typeof NAVEGACAO_ATUAL === 'object' && NAVEGACAO_ATUAL) NAVEGACAO_ATUAL.financeiro = false;
    nav.hidden = true;
  }
  function mostrarProcessamento() {
    ocultarConteudo();
    mostrarMensagem('processamento', 'clock', 'Preparando informações financeiras', TEXTO_PROCESSAMENTO, 'Verificar novamente');
  }
  // Registros existem, mas estão inconsistentes: não é "processamento".
  function mostrarConferencia() {
    ocultarConteudo();
    mostrarMensagem('conferencia', 'clipboard-text', 'Informações em conferência', TEXTO_CONFERENCIA, 'Verificar novamente');
    renderizarAvisos(false);
  }
  function mostrarSemFaturas() {
    ocultarConteudo();
    mostrarMensagem('vazio', 'folder-open', null, TEXTO_SEM_FATURAS, 'Verificar novamente');
  }

  function textoAtualizado(iso) {
    var data = iso ? new Date(iso) : null;
    if (!data || isNaN(data.getTime())) return '';
    var hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    var hoje = new Date();
    var mesmoDia = data.toDateString() === hoje.toDateString();
    return mesmoDia ? 'Atualizado às ' + hora : 'Atualizado em ' + data.toLocaleDateString('pt-BR') + ' às ' + hora;
  }
  // Na tela de conferência, a mensagem principal já cobre a contagem; só a
  // preparação (proposta/contrato ainda sem dados) continua listada.
  function renderizarAvisos(incluirConferencia) {
    var avisos = $('financeiroAvisos');
    var p = estado.dados.pendencias || {};
    var itens = [];
    if (incluirConferencia !== false && p.itensEmConferencia > 0) {
      itens.push(p.itensEmConferencia === 1
        ? '1 item está em conferência pela ITR e ainda não aparece nas abas.'
        : p.itensEmConferencia + ' itens estão em conferência pela ITR e ainda não aparecem nas abas.');
    }
    avisos.replaceChildren();
    if (!itens.length) { avisos.hidden = true; return; }
    var lista = el('ul');
    itens.forEach(function (texto) {
      var li = el('li');
      li.appendChild(icone('clock'));
      li.appendChild(el('span', null, texto));
      lista.appendChild(li);
    });
    avisos.appendChild(lista);
    avisos.hidden = false;
    converterIcones(avisos);
  }

  function renderizar() {
    var dados = estado.dados;
    if (!dados) return;
    contratosPorId = {};
    (dados.contratos || []).forEach(function (c) { contratosPorId[c.id] = c; });
    if (dados.estado === 'processamento') { mostrarProcessamento(); return; }
    if (dados.estado === 'conferencia') { mostrarConferencia(); return; }
    if (dados.estado === 'vazio') { mostrarSemFaturas(); return; }

    var caixaEstado = $('financeiroEstado');
    caixaEstado.hidden = true;
    caixaEstado.replaceChildren();
    var atualizado = $('financeiroAtualizado');
    atualizado.textContent = textoAtualizado(dados.atualizadoEm);
    atualizado.hidden = !atualizado.textContent;
    $('financeiroBuscaCaixa').hidden = false;
    renderizarAvisos();
    estado.aba = abaInicial();
    var abertaExiste = (dados.faturas || []).some(function (f) { return f.id === estado.aberta; })
      || (dados.contratos || []).some(function (c) { return c.id === estado.aberta; });
    if (!abertaExiste) estado.aberta = null;
    atualizarAbas();
    $('financeiroAbas').hidden = false;
    $('financeiroTabela').hidden = false;
    renderizarTabela();
  }

  /* ---- Carregamento (sem polling e sem cache; nova consulta a cada abertura ou ação) ---- */
  function carregar() {
    if (estado.emVoo) return estado.emVoo;
    // Dados anteriores saem da tela: nunca exibir números antigos como atuais.
    estado.dados = null;
    mostrarCarregando();
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
    estado.emVoo = fetch('/api/financeiro', { credentials: 'same-origin', cache: 'no-store', signal: controller ? controller.signal : undefined })
      .then(function (resp) {
        if (resp.status === 401) {
          window.location.replace('/login.html');
          return null;
        }
        if (resp.status === 403 || resp.status === 404) {
          mostrarIndisponivel();
          return null;
        }
        return ITR.jsonSeguro(resp).then(function (dados) {
          var valido = resp.ok && dados && dados.sucesso === true && ESTADOS.indexOf(dados.estado) >= 0
            && Array.isArray(dados.faturas) && Array.isArray(dados.contratos);
          if (!valido) throw new Error('Resposta financeira inválida');
          estado.dados = dados;
          renderizar();
        });
      })
      .catch(function () {
        estado.dados = null;
        mostrarErro();
      })
      .finally(function () {
        if (timer) clearTimeout(timer);
        estado.emVoo = null;
      });
    return estado.emVoo;
  }

  function ativarViewFinanceiro() {
    if (typeof NAVEGACAO_ATUAL !== 'object' || !NAVEGACAO_ATUAL || NAVEGACAO_ATUAL.financeiro !== true) {
      if (typeof ativarViewInicial === 'function') ativarViewInicial();
      return;
    }
    ocultarViewsPortal();
    painel.hidden = false;
    limparNavAtiva();
    nav.classList.add('ativo');
    document.body.classList.remove('conta-ativa');
    carregar();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---- Eventos ---- */
  nav.addEventListener('click', ativarViewFinanceiro);

  $('financeiroAbas').addEventListener('click', function (e) {
    var b = e.target.closest('[role="tab"]');
    if (b) selecionarAba(b.getAttribute('data-aba'), false);
  });
  $('financeiroAbas').addEventListener('keydown', function (e) {
    var ids = ABAS.map(function (a) { return a.id; });
    var atual = ids.indexOf(estado.aba);
    var destino = null;
    if (e.key === 'ArrowRight') destino = ids[(atual + 1) % ids.length];
    else if (e.key === 'ArrowLeft') destino = ids[(atual - 1 + ids.length) % ids.length];
    else if (e.key === 'Home') destino = ids[0];
    else if (e.key === 'End') destino = ids[ids.length - 1];
    if (!destino) return;
    e.preventDefault();
    selecionarAba(destino, true);
  });

  // Clique na linha também expande; links e botões internos mantêm o próprio comportamento.
  $('financeiroTabela').addEventListener('click', function (e) {
    var b = e.target.closest('.financeiro-detalhes-btn');
    if (b) { alternarDetalhe(b.getAttribute('data-id')); return; }
    if (e.target.closest('a, button, input, select, textarea')) return;
    var linha = e.target.closest('tr.financeiro-linha');
    if (linha) alternarDetalhe(linha.getAttribute('data-id'));
  });

  $('financeiroBusca').addEventListener('input', function () {
    estado.busca = this.value.slice(0, 60);
    estado.aberta = null;
    if (!estado.dados) return;
    atualizarAbas();
    renderizarTabela();
  });

  $('financeiroEstado').addEventListener('click', function (e) {
    if (e.target.closest('[data-acao="recarregar"]')) carregar();
  });

  // Proposta aceita durante a sessão (a confirmação acontece em outra guia):
  // ao voltar para o Portal, a navegação é reconsultada no máximo a cada 30 s
  // para exibir o Financeiro. Não há polling; o servidor continua decidindo.
  var ultimaRevisaoNavegacao = Date.now();
  window.addEventListener('focus', function () {
    if (!nav.hidden || document.body.classList.contains('portal-carregando')) return;
    if (typeof NAVEGACAO_ATUAL !== 'object' || !NAVEGACAO_ATUAL || NAVEGACAO_ATUAL.propostas !== true) return;
    if (Date.now() - ultimaRevisaoNavegacao < 30000) return;
    ultimaRevisaoNavegacao = Date.now();
    fetch('/api/navegacao', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (resp) { return resp.ok ? ITR.jsonSeguro(resp) : null; })
      .then(function (dados) {
        if (dados && dados.sucesso === true && dados.financeiro === true && NAVEGACAO_ATUAL) {
          NAVEGACAO_ATUAL.financeiro = true;
          nav.hidden = false;
        }
      })
      .catch(function () {});
  });
})();
