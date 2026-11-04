'use strict';
const { headers, verify, canonical } = require('./protocol');
const AUTH = '/internal/billing/v1/authorize';
function register(app, express, { config, service, store, clock = Date.now }) {
    let minute = 0, count = 0, inflight = 0;
    app.use('/internal/billing/v1', (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        res.set('X-Content-Type-Options', 'nosniff');
        if (!config.enabled) return res.status(503).json({ code: 'DISABLED' });
        const current = Math.floor(clock() / 60000);
        if (current !== minute) { minute = current; count = 0; }
        if (++count > 120 || inflight >= 4) return res.status(429).json({ code: 'RATE_LIMIT' });
        inflight++;
        let released = false;
        res.once('close', () => { if (!released) { released = true; inflight--; } });
        next();
    });
    async function authenticate(req, raw) {
        if (req.originalUrl !== req.path || !verify(config.secret, req.method, req.path, req.headers, raw, clock())) throw new Error('UNAUTHORIZED');
        if (!await store.nonce(req.headers['x-itr-nonce'], clock())) throw new Error('REPLAY');
    }
    function failure(res, error) {
        const unauthorized = ['UNAUTHORIZED', 'REPLAY'].includes(error.message);
        res.status(unauthorized ? 401 : 503).json({ code: unauthorized ? error.message : 'PORTAL_VALIDATION_FAILED' });
    }
    app.post(AUTH, express.raw({ type: 'application/json', limit: '16kb', inflate: false }), async (req, res) => {
        try {
            if (!Buffer.isBuffer(req.body)) throw new Error('UNAUTHORIZED');
            await authenticate(req, req.body);
            const input = JSON.parse(req.body);
            if (!input || Object.keys(input).sort().join(',') !== 'event,phase' || !['prepare', 'smtp'].includes(input.phase)) throw new Error('INVALID_EVENT');
            const { proof } = await service.validate(input.event, input.phase);
            const body = canonical({ ...proof, requestNonce: req.headers['x-itr-nonce'] });
            if (Buffer.byteLength(body) > 16384) throw new Error('PROOF_TOO_LARGE');
            res.set(headers(config.secret, 'RESPONSE', AUTH, body, clock())).status(200).send(body);
        } catch (error) { failure(res, error); }
    });
    app.get('/internal/billing/v1/pdf/:eventId/:attachmentId', async (req, res) => {
        try {
            if (Number(req.headers['content-length'] || 0) !== 0 || req.headers['transfer-encoding']) throw new Error('UNAUTHORIZED');
            await authenticate(req, '');
            if (!/^[a-f0-9]{64}$/.test(req.params.eventId) || !/^att[A-Za-z0-9]{14}$/.test(req.params.attachmentId)) throw new Error('INVALID_EVENT');
            const e = await store.repo.event(req.params.eventId), p = e?.payload;
            if (!p?.document || p.document.id !== req.params.attachmentId) throw new Error('DOCUMENT_SCOPE');
            const { bytes } = await service.validate(p, 'pdf');
            res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + (p.document.kind === 'nfse' ? 'NFSe.pdf' : 'Boleto.pdf') + '"',
                'x-itr-client-id': p.clientId, 'x-itr-invoice-id': p.invoiceId, 'x-itr-document-kind': p.document.kind,
                'x-itr-document-version': p.document.version }).send(bytes[p.document.kind]);
        } catch (error) { failure(res, error); }
    });
    app.use('/internal/billing/v1', (err, req, res, next) => {
        if (!err) return next();
        res.status(err.type === 'entity.too.large' ? 413 : 400).json({ code: 'INVALID_EVENT' });
    });
}
module.exports = { register, AUTH };
