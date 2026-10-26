 'use strict';
const { probeNotifications, PROPOSALS_CONTRACT } = require('../lib/notifications');
probeNotifications().then(result => {
  if (result.service !== 'itr-emails-whatsapp' || result.protocol !== 1 || result.emailSent !== false) throw new Error('Resposta incompatível: confira o destino e publique ambos os projetos atualizados.');
  if (result.proposalsContract !== PROPOSALS_CONTRACT) throw new Error('O serviço de e-mails não declara o contrato VERIFY v1: o código de aceite não seria entregue. Publique primeiro o serviço de e-mails atualizado.');
  console.log('OK: destino e assinatura HMAC validados. Nenhum e-mail enviado. SMTP e entrega ainda exigem teste real de primeiro acesso e recuperação.');
}).catch(error => { console.error(error.message); process.exitCode = 1; });
