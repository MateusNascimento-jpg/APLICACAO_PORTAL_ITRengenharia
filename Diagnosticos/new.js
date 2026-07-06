// testar_banco.js
require('dotenv').config();
const pool = require('./db');
pool.query('SELECT 1')
  .then(() => { console.log('BANCO OK — conectou'); process.exit(0); })
  .catch(e => { console.log('BANCO FALHOU:', e.message); process.exit(1); });