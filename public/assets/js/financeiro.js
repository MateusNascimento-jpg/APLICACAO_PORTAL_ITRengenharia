/* =========================================================================
   FINANCEIRO — uma linha por contrato (somente consulta)
   Usa somente /api/financeiro e o proxy autenticado de documentos. Nada aqui
   decide autorização: o servidor filtra por CNPJ e consolida a situação de
   cada contrato. As parcelas ficam no servidor; a tela lista CONTRATOS e não
   recebe nem exibe parcelas. Todo texto vindo da API entra no DOM por
   textContent (nunca innerHTML).
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
  var TEXTO_SEM_CONTRATOS = 'Nenhum contrato disponível no momento.';
  var ESTADOS = ['disponivel', 'conferencia', 'processamento', 'vazio'];
  var TEXTO_SEM_DOCUMENTOS = 'Ainda não há documentos anexados.';

  // Situação consolidada do contrato (servidor: mapper.situacaoContrato).
  var SITUACAO = {
    AGUARDANDO: 'Aguardando Emissão da NF',
    A_VENCER: 'A Vencer',
    VENCIDO: 'Vencido',
    PAGO: 'Pago',
    CANCELADO: 'Cancelado',
    PREPARACAO: 'Em preparação',
    CONFERENCIA: 'Em conferência'
  };
  var CLASSE_SITUACAO = {};
  CLASSE_SITUACAO[SITUACAO.AGUARDANDO] = 'aguardando';
  CLASSE_SITUACAO[SITUACAO.A_VENCER] = 'a-vencer';
  CLASSE_SITUACAO[SITUACAO.VENCIDO] = 'vencido';
  CLASSE_SITUACAO[SITUACAO.PAGO] = 'pago';
  CLASSE_SITUACAO[SITUACAO.CANCELADO] = 'cancelado';
  CLASSE_SITUACAO[SITUACAO.PREPARACAO] = 'preparacao';
  CLASSE_SITUACAO[SITUACAO.CONFERENCIA] = 'revisao';

  // Mesma tabela e densidade do layout original; cada linha é um CONTRATO.
  // "valor" alinha à direita com algarismos tabulares.
  var COLUNAS = [
    { rotulo: 'Contrato', classe: 'contrato', valor: nomeContrato },
    { rotulo: 'Condição de pagamento', classe: 'condicao', valor: condicaoPagamento },
    { rotulo: 'Valor total', classe: 'valor', valor: function (c) { return moeda(c.valorTotal); }, numero: true },
    { rotulo: 'Prazo para pagamento', classe: 'data', valor: function (c) { return textoPrazo(c.prazoPagamentoDias, true); } },
    { rotulo: 'Situação', classe: 'situacao', selo: true }
  ];

  var estado = {
    dados: null,
    emVoo: null,
    abertas: new Set(),
    busca: ''
  };

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
  function condicaoPagamento(contrato) {
    return (contrato && contrato.proposta && contrato.proposta.formaPagamento) || '—';
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

  function seloSituacao(contrato) {
    var caixa = el('span', 'financeiro-situacao');
    var situacao = contrato.situacao || SITUACAO.CONFERENCIA;
    caixa.appendChild(el('span', 'financeiro-selo ' + (CLASSE_SITUACAO[situacao] || ''), situacao));
    if (contrato.revisao) caixa.appendChild(el('span', 'financeiro-situacao-nota', 'Cobrança em revisão pela ITR'));
    return caixa;
  }

  /* ---- Documentos: somente o proxy autenticado, montado a partir de IDs ---- */
  var TIPOS_DOCUMENTO = { nfse: 'file-invoice', boleto: 'barcode', proposta: 'file-description', 'proposta-aceita':'file-description', comprovante:'file-check' };
  function urlDocumento(doc) {
    if (!Object.prototype.hasOwnProperty.call(TIPOS_DOCUMENTO, doc.tipo)) return null;
    if (doc.tipo === 'proposta-aceita' && /^rec[A-Za-z0-9]{14}$/.test(doc.registroId || '') && doc.anexoId === 'original')
      return '/api/propostas/' + encodeURIComponent(doc.registroId) + '/proposta-aceita';
    if (doc.tipo === 'comprovante' && /^rec[A-Za-z0-9]{14}$/.test(doc.registroId || '') && doc.anexoId === 'proof')
      return '/api/propostas/' + encodeURIComponent(doc.registroId) + '/comprovante';
    if (!/^rec[A-Za-z0-9]{14}$/.test(doc.registroId || '') || !/^att[A-Za-z0-9]{14}$/.test(doc.anexoId || '')) return null;
    return '/api/financeiro/documentos/' + encodeURIComponent(doc.tipo) + '/' + encodeURIComponent(doc.registroId) + '/' + encodeURIComponent(doc.anexoId);
  }
  function listaDocumentos(documentos) {
    var bloco = el('div', 'financeiro-documentos');
    bloco.appendChild(el('h3', 'financeiro-documentos-titulo', 'Documentos'));
    var vistos = new Set();
    var ordem = {'proposta-aceita': 0, proposta: 0, comprovante: 1, nfse: 2, boleto: 3};
    var validos = documentos.filter(function (doc) {
      if (!doc || !urlDocumento(doc)) return false;
      var chave = urlDocumento(doc);
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    }).sort(function (a, b) { return (ordem[a.tipo] ?? 9) - (ordem[b.tipo] ?? 9); });
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

  /* ---- Detalhes expandidos (inline, sem modal): só informações GERAIS ---- */
  function itemDetalhe(grade, rotulo, valor, nota) {
    var item = el('div', 'financeiro-detalhe-item');
    item.appendChild(el('dt', null, rotulo));
    var dd = el('dd', null, valor);
    if (nota) dd.appendChild(el('span', 'financeiro-detalhe-nota', nota));
    item.appendChild(dd);
    grade.appendChild(item);
  }
  function detalhesContrato(contrato) {
    var caixa = el('div', 'financeiro-detalhe');
    if (contrato.revisao) {
      caixa.appendChild(el('p', 'financeiro-detalhe-alerta', 'Este contrato foi cancelado e possui cobrança em revisão pela ITR.'));
    }
    var grade = el('dl', 'financeiro-detalhe-grade');
    var numero = contrato.proposta && contrato.proposta.numero;
    itemDetalhe(grade, 'Contrato', nomeContrato(contrato));
    itemDetalhe(grade, 'Proposta', numero ? 'Proposta ' + numero : '—');
    itemDetalhe(grade, 'Situação do contrato', contrato.status || '—');
    itemDetalhe(grade, 'Condição de pagamento', condicaoPagamento(contrato));
    itemDetalhe(grade, 'Prazo para pagamento', textoPrazo(contrato.prazoPagamentoDias));
    itemDetalhe(grade, 'Valor total', moeda(contrato.valorTotal));
    caixa.appendChild(grade);
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
  function textosContrato(c) {
    return [c.nome, c.proposta && c.proposta.numero];
  }

  /* ---- Tabela ---- */
  function classeCelula(coluna) {
    return 'fin-c-' + coluna.classe + (coluna.numero ? ' financeiro-num' : '');
  }
  function celula(coluna, contrato) {
    var td = el('td', classeCelula(coluna));
    td.setAttribute('data-rotulo', coluna.rotulo);
    if (coluna.selo) td.appendChild(seloSituacao(contrato));
    else td.textContent = coluna.valor(contrato);
    return td;
  }
  function botaoDetalhes(id, rotulo) {
    var b = botao('financeiro-detalhes-btn', null, 'detalhes');
    b.setAttribute('aria-expanded', estado.abertas.has(id) ? 'true' : 'false');
    b.setAttribute('aria-controls', 'fin-det-' + id);
    b.setAttribute('aria-label', 'Detalhes de ' + rotulo);
    b.setAttribute('data-id', id);
    b.appendChild(el('span', 'financeiro-detalhes-texto', 'Detalhes'));
    b.appendChild(icone('chevron-down'));
    return b;
  }
  // Uma linha de resumo + uma linha de detalhes (oculta até "Detalhes").
  function linhasContrato(contrato) {
    var id = contrato.id;
    var aberta = estado.abertas.has(id);
    var tr = el('tr', 'financeiro-linha' + (aberta ? ' aberta' : ''));
    tr.setAttribute('data-id', id);
    COLUNAS.forEach(function (coluna) { tr.appendChild(celula(coluna, contrato)); });
    var acao = el('td', 'financeiro-acao');
    acao.appendChild(botaoDetalhes(id, nomeContrato(contrato).slice(0, 120)));
    tr.appendChild(acao);

    var trDetalhe = el('tr', 'financeiro-detalhe-linha');
    trDetalhe.id = 'fin-det-' + id;
    trDetalhe.hidden = !aberta;
    var td = el('td');
    td.colSpan = COLUNAS.length + 1;
    td.appendChild(detalhesContrato(contrato));
    trDetalhe.appendChild(td);
    return [tr, trDetalhe];
  }
  function cabecalhoTabela() {
    var thead = el('thead');
    var tr = el('tr');
    COLUNAS.forEach(function (coluna) {
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
  function separadorContratos() {
    var separador = el('tr', 'financeiro-separador-contratos');
    separador.setAttribute('aria-hidden', 'true');
    var espaco = el('td');
    espaco.colSpan = COLUNAS.length + 1;
    separador.appendChild(espaco);
    return separador;
  }
  // Tabela original: uma linha por CONTRATO, Detalhes embutidos e um pequeno
  // respiro entre contratos. Sem abas, cartões ou listas de parcelas.
  function renderizarTabela() {
    var area = $('financeiroTabela');
    area.replaceChildren();
    var contratos = (estado.dados.contratos || []).filter(function (c) {
      return correspondeBusca(textosContrato(c));
    });
    if (!contratos.length) {
      area.appendChild(el('p', 'financeiro-vazio', normalizarBusca(estado.busca)
        ? 'Nenhum contrato encontrado para esta busca.' : TEXTO_SEM_CONTRATOS));
      return;
    }
    var tabela = el('table', 'financeiro-tabela-dados financeiro-lista-unica');
    tabela.appendChild(el('caption', 'visualmente-oculto', 'Contratos da sua empresa'));
    tabela.appendChild(cabecalhoTabela());
    var corpo = el('tbody');
    contratos.forEach(function (contrato, indice) {
      if (indice > 0) corpo.appendChild(separadorContratos());
      var par = linhasContrato(contrato);
      corpo.append(par[0], par[1]);
    });
    tabela.appendChild(corpo);
    area.appendChild(tabela);
    converterIcones(area);
  }

  function alternarDetalhe(id) {
    var aberto = estado.abertas.has(id);
    if (aberto) estado.abertas.delete(id);
    else estado.abertas.add(id);
    var detalhe = $('fin-det-' + id);
    if (detalhe) detalhe.hidden = aberto;
    var botoes = $('financeiroTabela').querySelectorAll('.financeiro-detalhes-btn');
    Array.prototype.forEach.call(botoes, function (b) {
      if (b.getAttribute('data-id') === id) b.setAttribute('aria-expanded', aberto ? 'false' : 'true');
    });
    var linhas = $('financeiroTabela').querySelectorAll('tr.financeiro-linha');
    Array.prototype.forEach.call(linhas, function(tr) {
      if(tr.getAttribute('data-id') === id) tr.classList.toggle('aberta', !aberto);
    });
  }

  /* ---- Estados: carregando, processamento, erro, indisponível ---- */
  function ocultarConteudo() {
    ['financeiroBuscaCaixa', 'financeiroAvisos', 'financeiroTabela', 'financeiroAtualizado'].forEach(function (id) {
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
  function mostrarSemContratos() {
    ocultarConteudo();
    mostrarMensagem('vazio', 'folder-open', null, TEXTO_SEM_CONTRATOS, 'Verificar novamente');
  }

  function textoAtualizado(iso) {
    var data = iso ? new Date(iso) : null;
    if (!data || isNaN(data.getTime())) return '';
    var hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    var hoje = new Date();
    var mesmoDia = data.toDateString() === hoje.toDateString();
    return mesmoDia ? 'Atualizado às ' + hora : 'Atualizado em ' + data.toLocaleDateString('pt-BR') + ' às ' + hora;
  }
  // Na tela de conferência, a mensagem principal já cobre a contagem. Proposta
  // aceita cujo contrato ainda não foi cadastrado pela equipe é informada aqui,
  // sem virar linha da tabela (a tabela só lista contratos).
  function renderizarAvisos(incluirConferencia) {
    var avisos = $('financeiroAvisos');
    var p = estado.dados.pendencias || {};
    var itens = [];
    if (incluirConferencia !== false && p.itensEmConferencia > 0) {
      itens.push(p.itensEmConferencia === 1
        ? '1 item está em conferência pela ITR e ainda não aparece na lista.'
        : p.itensEmConferencia + ' itens estão em conferência pela ITR e ainda não aparecem na lista.');
    }
    if (incluirConferencia !== false) {
      (p.propostasEmPreparacao || []).forEach(function (proposta) {
        if (proposta && proposta.numero) {
          itens.push('Proposta ' + proposta.numero + ' aceita: o contrato aparecerá nesta lista após o processamento comercial.');
        }
      });
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
    if (dados.estado === 'processamento') { mostrarProcessamento(); return; }
    if (dados.estado === 'conferencia') { mostrarConferencia(); return; }
    if (dados.estado === 'vazio') { mostrarSemContratos(); return; }

    var caixaEstado = $('financeiroEstado');
    caixaEstado.hidden = true;
    caixaEstado.replaceChildren();
    var atualizado = $('financeiroAtualizado');
    atualizado.textContent = textoAtualizado(dados.atualizadoEm);
    atualizado.hidden = !atualizado.textContent;
    $('financeiroBuscaCaixa').hidden = false;
    renderizarAvisos();
    // Contratos começam recolhidos; "Detalhes" expande cada um.
    estado.abertas = new Set();
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
            && Array.isArray(dados.contratos);
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
    if (!estado.dados) return;
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
