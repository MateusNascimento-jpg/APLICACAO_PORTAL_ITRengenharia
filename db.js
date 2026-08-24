const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
    host: config.db.host,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    port: config.db.port,
    waitForConnections: true,
    connectionLimit: config.db.connectionLimit,
    queueLimit: config.db.queueLimit,
    connectTimeout: config.db.connectTimeoutMs,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    ...(config.db.ssl ? { ssl: { rejectUnauthorized: true } } : {})
});

async function verificarBanco() {
    const conn = await pool.getConnection();
    try {
        await conn.query('SELECT 1 AS ok');
        return true;
    } finally {
        conn.release();
    }
}

async function encerrarBanco() {
    await pool.end();
}

module.exports = pool;
module.exports.verificarBanco = verificarBanco;
module.exports.encerrarBanco = encerrarBanco;
