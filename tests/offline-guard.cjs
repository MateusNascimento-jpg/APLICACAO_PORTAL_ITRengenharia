'use strict';
// Preload only in tests: never read real .env, connect to a database or SMTP.
const Module = require('node:module');
const load = Module._load;
Module._load = function (name, ...args) {
    if (name === 'dotenv') return { config: () => ({ parsed: {} }) };
    return load.call(this, name, ...args);
};
const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    const a = Array.isArray(args[0]) ? args[0] : args;
    const host = typeof a[0] === 'object' ? a[0].host : a[1];
    const port = Number(typeof a[0] === 'object' ? a[0].port : a[0]);
    if (!['127.0.0.1', 'localhost', '::1'].includes(host) || [25, 465, 587, 3306].includes(port))
        throw new Error('OFFLINE_NETWORK_BLOCKED');
    return connect.apply(this, args);
};
const fetcher = global.fetch;
global.fetch = (url, ...args) => {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname))
        throw new Error('OFFLINE_FETCH_BLOCKED');
    return fetcher(url, ...args);
};
