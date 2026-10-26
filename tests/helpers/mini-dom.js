'use strict';

// DOM mínimo, só o necessário para executar public/assets/js/financeiro.js no
// Node (node:test) sem dependências novas: criação de elementos, atributos,
// classes, textContent, hidden, eventos com bubbling, closest e seletores
// simples (tag, .classe, #id, [atributo], combinações sem espaço e
// descendência por espaço). Não interpreta HTML: innerHTML não existe aqui de
// propósito, como no código testado.

class Node {
    constructor(ownerDocument) {
        this.ownerDocument = ownerDocument;
        this.parentNode = null;
        this.childNodes = [];
    }
    get textContent() {
        return this.childNodes.map(n => n.textContent).join('');
    }
    set textContent(valor) {
        this.childNodes.forEach(n => { n.parentNode = null; });
        this.childNodes = [];
        if (valor != null && String(valor) !== '') this.appendChild(new Text(this.ownerDocument, String(valor)));
    }
    appendChild(no) {
        if (no.parentNode) no.parentNode.removeChild(no);
        no.parentNode = this;
        this.childNodes.push(no);
        return no;
    }
    append(...nos) {
        nos.forEach(no => this.appendChild(typeof no === 'string' ? new Text(this.ownerDocument, no) : no));
    }
    removeChild(no) {
        this.childNodes = this.childNodes.filter(n => n !== no);
        no.parentNode = null;
        return no;
    }
    replaceChildren(...nos) {
        this.childNodes.forEach(n => { n.parentNode = null; });
        this.childNodes = [];
        this.append(...nos);
    }
}

class Text extends Node {
    constructor(ownerDocument, valor) {
        super(ownerDocument);
        this.valor = valor;
    }
    get textContent() { return this.valor; }
    set textContent(valor) { this.valor = String(valor); }
}

class ClassList {
    constructor(elemento) { this.elemento = elemento; }
    lista() { return String(this.elemento.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
    gravar(lista) { this.elemento.setAttribute('class', lista.join(' ')); }
    contains(nome) { return this.lista().includes(nome); }
    add(...nomes) { const l = this.lista(); nomes.forEach(n => { if (!l.includes(n)) l.push(n); }); this.gravar(l); }
    remove(...nomes) { this.gravar(this.lista().filter(n => !nomes.includes(n))); }
    toggle(nome, forcar) {
        const ativo = forcar === undefined ? !this.contains(nome) : Boolean(forcar);
        if (ativo) this.add(nome); else this.remove(nome);
        return ativo;
    }
}

const PROPRIEDADES_ATRIBUTO = { id: 'id', className: 'class', href: 'href', rel: 'rel', target: 'target', title: 'title', type: 'type', scope: 'scope', placeholder: 'placeholder' };

class Element extends Node {
    constructor(ownerDocument, tagName) {
        super(ownerDocument);
        this.tagName = tagName.toUpperCase();
        this.atributos = new Map();
        this.ouvintes = new Map();
        this.classList = new ClassList(this);
        this.colSpan = 1;
        this.tabIndex = -1;
        this.value = '';
    }
    getAttribute(nome) { return this.atributos.has(nome) ? this.atributos.get(nome) : null; }
    setAttribute(nome, valor) { this.atributos.set(nome, String(valor)); }
    removeAttribute(nome) { this.atributos.delete(nome); }
    hasAttribute(nome) { return this.atributos.has(nome); }
    get hidden() { return this.atributos.has('hidden'); }
    set hidden(valor) { if (valor) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    get children() { return this.childNodes.filter(n => n instanceof Element); }
    addEventListener(tipo, fn) {
        if (!this.ouvintes.has(tipo)) this.ouvintes.set(tipo, []);
        this.ouvintes.get(tipo).push(fn);
    }
    dispatchEvent(evento) {
        evento.target = evento.target || this;
        for (let no = this; no; no = no.parentNode) {
            (no.ouvintes?.get(evento.type) || []).forEach(fn => fn.call(no, evento));
        }
        return true;
    }
    click() { this.dispatchEvent({ type: 'click', target: this, preventDefault() {} }); }
    focus() { this.ownerDocument.activeElement = this; }
    matches(seletor) { return seletor.split(',').some(s => corresponde(this, s.trim())); }
    closest(seletor) {
        for (let no = this; no instanceof Element; no = no.parentNode) if (no.matches(seletor)) return no;
        return null;
    }
    querySelectorAll(seletor) {
        const encontrados = [];
        const visitar = no => no.children.forEach(filho => {
            if (filho.matches(seletor)) encontrados.push(filho);
            visitar(filho);
        });
        visitar(this);
        return encontrados;
    }
    querySelector(seletor) { return this.querySelectorAll(seletor)[0] || null; }
}

for (const [propriedade, atributo] of Object.entries(PROPRIEDADES_ATRIBUTO)) {
    Object.defineProperty(Element.prototype, propriedade, {
        get() { return this.getAttribute(atributo) || ''; },
        set(valor) { this.setAttribute(atributo, valor); },
    });
}

// Seletor composto simples: tag, #id, .classe e [attr] / [attr="valor"].
function correspondeSimples(elemento, seletor) {
    const partes = seletor.match(/^[a-zA-Z][\w-]*|#[\w-]+|\.[\w-]+|\[[^\]]+\]/g);
    if (!partes || partes.join('') !== seletor) throw new Error(`mini-dom: seletor não suportado: ${seletor}`);
    return partes.every(parte => {
        if (parte[0] === '#') return elemento.id === parte.slice(1);
        if (parte[0] === '.') return elemento.classList.contains(parte.slice(1));
        if (parte[0] === '[') {
            const [, nome, valor] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(parte) || [];
            if (!nome) throw new Error(`mini-dom: atributo não suportado: ${parte}`);
            return valor === undefined ? elemento.hasAttribute(nome) : elemento.getAttribute(nome) === valor;
        }
        return elemento.tagName === parte.toUpperCase();
    });
}

function corresponde(elemento, seletor) {
    const niveis = seletor.split(/\s+/).filter(Boolean);
    if (!correspondeSimples(elemento, niveis.pop())) return false;
    let atual = elemento.parentNode;
    for (let i = niveis.length - 1; i >= 0; i -= 1) {
        while (atual instanceof Element && !correspondeSimples(atual, niveis[i])) atual = atual.parentNode;
        if (!(atual instanceof Element)) return false;
        atual = atual.parentNode;
    }
    return true;
}

class Document extends Element {
    constructor() {
        super(null, '#document');
        this.ownerDocument = this;
        this.body = this.createElement('body');
        this.appendChild(this.body);
        this.activeElement = null;
    }
    createElement(tag) { return new Element(this, tag); }
    createTextNode(valor) { return new Text(this, String(valor)); }
    getElementById(id) { return this.querySelector('#' + id); }
}

// Cria um documento com os elementos de `ids` (tag padrão div) dentro do body.
function criarDocumento(estrutura) {
    const documento = new Document();
    for (const [id, tag = 'div', atributos = {}] of estrutura) {
        const elemento = documento.createElement(tag);
        elemento.id = id;
        for (const [nome, valor] of Object.entries(atributos)) elemento.setAttribute(nome, valor);
        documento.body.appendChild(elemento);
    }
    return documento;
}

module.exports = { criarDocumento, Element };
