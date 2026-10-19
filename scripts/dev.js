const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { marker, allowed, root } = require('../preview/guard');
const env = { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' };
const preview = fs.existsSync(marker);
if (preview && !allowed(env)) {
  console.error('Prévia local bloqueada neste ambiente. Nenhum servidor foi iniciado.');
  process.exit(1);
}
const child = spawn(process.execPath, preview ? ['--watch', 'preview/server.js'] : ['--watch', 'server.js'], { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
