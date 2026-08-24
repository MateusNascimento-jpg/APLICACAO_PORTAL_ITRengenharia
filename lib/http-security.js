const config = require('../config');

function applySecurityHeaders(req, res, next) {
    const csp = [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "media-src 'self'",
        "worker-src 'none'",
        "manifest-src 'self'",
        "upgrade-insecure-requests"
    ];
    if (!config.production) csp.pop();

    res.setHeader('Content-Security-Policy', csp.join('; '));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Origin-Agent-Cluster', '?1');
    if (config.production && (req.secure || req.headers['x-forwarded-proto'] === 'https')) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    }
    next();
}

function sameOriginOnly(req, res, next) {
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (!unsafe) return next();

    const expected = config.publicOrigin;
    const origin = req.get('origin');
    const referer = req.get('referer');
    const fetchSite = String(req.get('sec-fetch-site') || '').toLowerCase();

    if (fetchSite && ['cross-site', 'none'].includes(fetchSite)) {
        return res.status(403).json({ sucesso: false, erro: 'Origem da requisição não permitida.' });
    }

    if (origin) {
        if (origin === expected) return next();
        if (!config.production) {
            const proto = req.secure ? 'https' : 'http';
            const host = req.get('host');
            if (host && origin === `${proto}://${host}`) return next();
        }
        return res.status(403).json({ sucesso: false, erro: 'Origem da requisição não permitida.' });
    }

    if (referer) {
        try {
            const refOrigin = new URL(referer).origin;
            if (refOrigin === expected) return next();
            if (!config.production) {
                const proto = req.secure ? 'https' : 'http';
                const host = req.get('host');
                if (host && refOrigin === `${proto}://${host}`) return next();
            }
        } catch (_) {}
        return res.status(403).json({ sucesso: false, erro: 'Origem da requisição não permitida.' });
    }

    // Navegadores modernos enviam Origin ou Referer em POST/PATCH. Em produção,
    // ausência dos dois é tratada como suspeita; localhost continua amigável a testes.
    if (config.production) {
        return res.status(403).json({ sucesso: false, erro: 'Origem da requisição não permitida.' });
    }
    return next();
}

module.exports = { applySecurityHeaders, sameOriginOnly };
