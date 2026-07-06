const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10, 
    queueLimit: 0
}); 

pool.getConnection()
    .then(conn => {
        console.log('Sucesso: Conectado ao banco ITRengenhariaLOGIN! ------> Nome do banco: ' + process.env.DB_NAME);
        conn.release(); 
    })
    .catch(err => {
        console.error('Erro crítico ao conectar no MySQl:', err.message);
    });

module.exports = pool;  
