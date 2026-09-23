 'use strict';
const { probeNotifications } = require('../lib/notifications');
probeNotifications().then(result => {
  if (result.service !== 'itr-emails-whatsapp' || result.protocol !== 1 || result.emailSent !== false) throw new Error('Resposta incompatível: confira o destino e publique ambos os projetos atualizados.');
  console.log('OK: destino e assinatura HMAC validados. Nenhum e-mail enviado. SMTP e entrega ainda exigem teste real de primeiro acesso e recuperação.');
}).catch(error => { console.error(error.message); process.exitCode = 1; });
