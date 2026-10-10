'use strict';

const crypto = require('node:crypto');
const MAX_PDF_BYTES = 10 * 1024 * 1024;

function allowedUrl(value) {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed = host === 'dl.airtable.com' || host.endsWith('.airtableusercontent.com');
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed) {
        throw new Error('PDF_DESTINATION_DENIED');
    }
    return url;
}

async function readPdf(url, fetcher = fetch) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
        let target = allowedUrl(url);
        for (let redirects = 0; redirects <= 3; redirects += 1) {
            const response = await fetcher(target.href, {
                redirect: 'manual',
                signal: controller.signal,
            });
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                await response.body?.cancel();
                target = allowedUrl(new URL(response.headers.get('location'), target).href);
                continue;
            }
            if (!response.ok || !response.body) throw new Error('PDF_UNAVAILABLE');
            const type = (response.headers.get('content-type') || '')
                .split(';')[0]
                .trim()
                .toLowerCase();
            if (!['application/pdf', 'application/octet-stream'].includes(type))
                throw new Error('PDF_TYPE_INVALID');
            if (Number(response.headers.get('content-length')) > MAX_PDF_BYTES)
                throw new Error('PDF_TOO_LARGE');
            const chunks = [];
            let size = 0;
            for await (const chunk of response.body) {
                size += chunk.length;
                if (size > MAX_PDF_BYTES) {
                    controller.abort();
                    throw new Error('PDF_TOO_LARGE');
                }
                chunks.push(Buffer.from(chunk));
            }
            const bytes = Buffer.concat(chunks);
            if (
                bytes.subarray(0, 5).toString('ascii') !== '%PDF-' ||
                !bytes.subarray(-2048).includes(Buffer.from('%%EOF'))
            ) {
                throw new Error('PDF_CONTENT_INVALID');
            }
            return { bytes, hash: crypto.createHash('sha256').update(bytes).digest('hex') };
        }
        throw new Error('PDF_REDIRECT_LIMIT');
    } finally {
        clearTimeout(timer);
    }
}

function disposition(name, mode = 'inline') {
    const safe = String(name || 'Proposta.pdf')
        .replace(/[\x00-\x1f\x7f/\\"]/g, '_')
        .slice(0, 160);
    return `${mode}; filename="Proposta.pdf"; filename*=UTF-8''${encodeURIComponent(safe).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16))}`;
}

module.exports = { readPdf, allowedUrl, disposition, MAX_PDF_BYTES };
