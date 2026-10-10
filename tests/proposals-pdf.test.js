'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readPdf, allowedUrl, disposition, MAX_PDF_BYTES } = require('../lib/proposals/pdf');
const { createSecrets } = require('../lib/proposals/crypto');
const { headers, verify } = require('../lib/proposals/protocol');

const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');

test('PDF original preserva bytes; destino, redirecionamentos e HTML são rejeitados', async () => {
    const result = await readPdf(
        'https://v5.airtableusercontent.com/x',
        async () => new Response(pdf, { headers: { 'content-type': 'application/pdf' } }),
    );
    assert.deepEqual(result.bytes, pdf);
    for (const url of [
        'http://dl.airtable.com/x',
        'https://127.0.0.1/x',
        'https://dl.airtable.com.evil.test/x',
        'https://user@dl.airtable.com/x',
    ])
        assert.throws(() => allowedUrl(url));
    await assert.rejects(
        readPdf(
            'https://dl.airtable.com/x',
            async () =>
                new Response(null, {
                    status: 302,
                    headers: { location: 'http://localhost/private' },
                }),
        ),
        /PDF_DESTINATION_DENIED/,
    );
    await assert.rejects(
        readPdf(
            'https://dl.airtable.com/x',
            async () => new Response('<html>', { headers: { 'content-type': 'application/pdf' } }),
        ),
        /PDF_CONTENT_INVALID/,
    );
    await assert.rejects(
        readPdf(
            'https://dl.airtable.com/x',
            async () => new Response(pdf, { headers: { 'content-type': 'text/html' } }),
        ),
        /PDF_TYPE_INVALID/,
    );
    await assert.rejects(
        readPdf(
            'https://dl.airtable.com/x',
            async () =>
                new Response(pdf, {
                    headers: {
                        'content-type': 'application/pdf',
                        'content-length': MAX_PDF_BYTES + 1,
                    },
                }),
        ),
        /PDF_TOO_LARGE/,
    );
    assert.doesNotMatch(disposition('bad\r\nInjected.pdf'), /\r|\n/);
});

test('assinatura comercial vincula corpo, método e rota; AES-GCM detecta adulteração', () => {
    const key = Buffer.alloc(32, 8).toString('base64');
    const signed = headers(key, 'POST', '/internal/proposals/events', '{}');
    assert.equal(verify(key, 'POST', '/internal/proposals/events', signed, '{}'), true);
    assert.equal(verify(key, 'GET', '/internal/proposals/events', signed, '{}'), false);
    assert.equal(verify(key, 'POST', '/internal/other', signed, '{}'), false);
    assert.equal(verify(key, 'POST', '/internal/proposals/events', signed, '{"x":1}'), false);
    const secrets = createSecrets(key);
    const sealed = secrets.seal({ test: true });
    assert.deepEqual(secrets.open(sealed), { test: true });
    const bytes = Buffer.from(sealed, 'base64');
    bytes[30] ^= 1;
    assert.throws(() => secrets.open(bytes.toString('base64')));
});
