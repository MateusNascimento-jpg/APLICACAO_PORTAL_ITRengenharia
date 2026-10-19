'use strict';

// Leitura segura de anexos (cenário 10 do handoff): destino, redirecionamento,
// tipo, assinatura binária, tamanho e cabeçalho Content-Disposition.

const test = require('node:test');
const assert = require('node:assert/strict');
const { lerDocumento, disposicao, criarLimitadorDownloads, LIMITE_BYTES } = require('../lib/financeiro/documentos');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const XML = Buffer.from('\uFEFF<?xml version="1.0"?><NFSe><Numero>1</Numero></NFSe>');
const URL_OK = 'https://v5.airtableusercontent.com/ficticio/arquivo';

function resposta(corpo, tipo, extra = {}) {
    return async () => new Response(corpo, { headers: { 'content-type': tipo, ...extra } });
}

test('arquivos válidos: PDF, PNG e XML com assinatura conferida', async () => {
    assert.deepEqual((await lerDocumento(URL_OK, 'application/pdf', resposta(PDF, 'application/pdf'))).bytes, PDF);
    assert.equal((await lerDocumento(URL_OK, 'application/pdf', resposta(PDF, 'application/octet-stream'))).mime, 'application/pdf');
    assert.equal((await lerDocumento(URL_OK, 'image/png', resposta(PNG, 'image/png'))).mime, 'image/png');
    assert.equal((await lerDocumento(URL_OK, 'text/xml', resposta(XML, 'application/xml; charset=utf-8'))).mime, 'text/xml');
    assert.equal((await lerDocumento('https://dl.airtable.com/x', 'application/pdf', resposta(PDF, ''))).mime, 'application/pdf');
});

test('destinos negados antes de qualquer requisição', async () => {
    let chamadas = 0;
    const contar = async () => { chamadas += 1; return new Response(PDF); };
    for (const url of [
        'http://v5.airtableusercontent.com/x',
        'https://127.0.0.1/x',
        'https://airtableusercontent.com.evil.test/x',
        'https://user:pass@v5.airtableusercontent.com/x',
        'https://v5.airtableusercontent.com:8443/x',
        'file:///etc/passwd',
        'não é url',
    ]) {
        await assert.rejects(lerDocumento(url, 'application/pdf', contar), /DOC_DESTINATION_DENIED/, url);
    }
    assert.equal(chamadas, 0);
    await assert.rejects(lerDocumento(URL_OK, 'text/html', contar), /DOC_TYPE_INVALID/);
    assert.equal(chamadas, 0);
});

test('redirecionamentos: revalidados a cada salto e limitados', async () => {
    const paraFora = async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } });
    await assert.rejects(lerDocumento(URL_OK, 'application/pdf', paraFora), /DOC_DESTINATION_DENIED/);

    let saltos = 0;
    const permitido = async url => {
        saltos += 1;
        if (url === URL_OK) return new Response(null, { status: 307, headers: { location: '/outro' } });
        return new Response(PDF, { headers: { 'content-type': 'application/pdf' } });
    };
    assert.ok(await lerDocumento(URL_OK, 'application/pdf', permitido));
    assert.equal(saltos, 2);

    const loop = async () => new Response(null, { status: 302, headers: { location: URL_OK } });
    await assert.rejects(lerDocumento(URL_OK, 'application/pdf', loop), /DOC_REDIRECT_LIMIT/);
    const semDestino = async () => new Response(null, { status: 302 });
    await assert.rejects(lerDocumento(URL_OK, 'application/pdf', semDestino), /DOC_REDIRECT_INVALID/);
});

test('conteúdo inválido, expirado ou grande demais é recusado sem vazar detalhes', async () => {
    await assert.rejects(lerDocumento(URL_OK, 'application/pdf', resposta('<html>login</html>', 'application/pdf')), /DOC_CONTENT_INVALID/);
    await assert.rejects(lerDocumento(URL_OK, 'application/pdf', resposta(PDF, 'text/html')), /DOC_TYPE_INVALID/);
    await assert.rejects(lerDocumento(URL_OK, 'text/xml', resposta('<!DOCTYPE html><html></html>', 'text/xml')), /DOC_CONTENT_INVALID/);
    await assert.rejects(lerDocumento(URL_OK, 'image/png', resposta(PDF, 'image/png')), /DOC_CONTENT_INVALID/);
    await assert.rejects(lerDocumento(URL_OK, 'application/pdf', async () => new Response('expirado', { status: 410 })), /DOC_UNAVAILABLE/);
    await assert.rejects(lerDocumento(URL_OK, 'application/pdf', async () => new Response('x', { status: 404 })), /DOC_UNAVAILABLE/);
    await assert.rejects(
        lerDocumento(URL_OK, 'application/pdf', resposta(PDF, 'application/pdf', { 'content-length': String(LIMITE_BYTES + 1) })),
        /DOC_TOO_LARGE/,
    );
    // Sem Content-Length: o limite é aplicado durante a leitura.
    const grande = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode('%PDF-'));
            controller.enqueue(new Uint8Array(LIMITE_BYTES));
            controller.close();
        },
    });
    await assert.rejects(lerDocumento(URL_OK, 'application/pdf', async () => new Response(grande, { headers: { 'content-type': 'application/pdf' } })), /DOC_TOO_LARGE/);
    // Timeout do upstream vira código próprio.
    const travado = async (_, { signal }) => new Promise((_, rejeitar) => signal.addEventListener('abort', () => rejeitar(Object.assign(new Error('abort'), { name: 'AbortError' }))));
    const original = global.setTimeout;
    global.setTimeout = (fn, ms) => original(fn, Math.min(ms, 5));
    try {
        await assert.rejects(lerDocumento(URL_OK, 'application/pdf', travado), /DOC_TIMEOUT/);
    } finally {
        global.setTimeout = original;
    }
});

test('Content-Disposition seguro com fallback ASCII e UTF-8', () => {
    assert.equal(disposicao('NFSe 0001.pdf', 'inline'), `inline; filename="NFSe 0001.pdf"; filename*=UTF-8''NFSe%200001.pdf`);
    const perigoso = disposicao('a"b\r\nSet-Cookie: x=1;/../boleto ção.pdf', 'attachment');
    assert.doesNotMatch(perigoso, /[\r\n]/);
    assert.match(perigoso, /^attachment; filename="a_b__Set-Cookie: x=1__\.\._boleto cao\.pdf"; filename\*=UTF-8''/);
    assert.match(disposicao('', 'qualquer'), /^attachment; filename="documento"/);
});

// Achado 4 da auditoria: memória e simultaneidade nos downloads.
test('limitador: vagas por conta e no servidor, orçamento de bytes e liberação idempotente', () => {
    const limitador = criarLimitadorDownloads({ maxSimultaneos: 3, maxPorConta: 2, orcamentoBytes: 100 });
    const a1 = limitador.entrar('A');
    const a2 = limitador.entrar('A');
    assert.ok(a1.ok && a2.ok);
    assert.deepEqual(limitador.entrar('A'), { ok: false, motivo: 'CONTA' });
    const b1 = limitador.entrar('B');
    assert.ok(b1.ok);
    assert.deepEqual(limitador.entrar('C'), { ok: false, motivo: 'SERVIDOR' });

    assert.equal(a1.reservar(60), true);
    assert.equal(b1.reservar(50), false, 'orçamento global de 100 bytes');
    assert.equal(a2.reservar(40), true);
    assert.deepEqual(limitador.situacao(), { ativos: 3, bytesReservados: 100, contas: 2 });

    a1.sair();
    a1.sair();
    assert.deepEqual(limitador.situacao(), { ativos: 2, bytesReservados: 40, contas: 2 }, 'sair() devolve vaga e bytes uma única vez');
    assert.equal(a1.reservar(1), false, 'vaga encerrada não reserva mais');
    assert.ok(limitador.entrar('C').ok);
    a2.sair();
    b1.sair();
    assert.equal(limitador.situacao().contas, 1);
});

test('leitura respeita o orçamento: recusa antes de alocar (com Content-Length) e durante a leitura (sem)', async () => {
    let reservado = 0;
    const orcamento = limite => bytes => {
        if (reservado + bytes > limite) return false;
        reservado += bytes;
        return true;
    };
    await assert.rejects(
        lerDocumento(URL_OK, 'application/pdf', resposta(PDF, 'application/pdf', { 'content-length': String(PDF.length) }), orcamento(10)),
        /DOC_BUSY/,
    );
    assert.equal(reservado, 0, 'nada alocado quando o tamanho declarado não cabe');

    reservado = 0;
    const ok = await lerDocumento(URL_OK, 'application/pdf', resposta(PDF, 'application/pdf', { 'content-length': String(PDF.length) }), orcamento(1000));
    assert.deepEqual(ok.bytes, PDF);
    assert.equal(reservado, PDF.length, 'com tamanho declarado: um único buffer (1x o arquivo)');

    reservado = 0;
    const semTamanho = () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(PDF)); c.close(); } }), { headers: { 'content-type': 'application/pdf' } });
    const lido = await lerDocumento(URL_OK, 'application/pdf', async () => semTamanho(), orcamento(1000));
    assert.deepEqual(lido.bytes, PDF);
    assert.equal(reservado, PDF.length * 2, 'sem tamanho declarado: partes + junção entram no orçamento');
    reservado = 0;
    await assert.rejects(lerDocumento(URL_OK, 'application/pdf', async () => semTamanho(), orcamento(PDF.length + 5)), /DOC_BUSY/);

    const mentiroso = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(PDF)); c.close(); } }), {
        headers: { 'content-type': 'application/pdf', 'content-length': '10' },
    });
    await assert.rejects(lerDocumento(URL_OK, 'application/pdf', mentiroso, () => true), /DOC_CONTENT_INVALID|terminated|length/i);
});
