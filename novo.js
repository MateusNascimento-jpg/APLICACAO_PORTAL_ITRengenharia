/**
 * teste_email.js — ITR Engenharia
 * -------------------------------------------------------------
 * Testa o envio de e-mail SOZINHO, antes de mexer em rotas/telas.
 * Se isto funcionar, o resto da recuperação de senha vai funcionar.
 *
 * COMO USAR:
 *   1) npm install nodemailer   (se ainda não instalou)
 *   2) confira o .env (SMTP_HOST/PORT/USER/PASS preenchidos)
 *   3) troque o DESTINO abaixo por um e-mail SEU (para você receber e conferir)
 *   4) node teste_email.js
 * -------------------------------------------------------------
 */

const { verificarConexao, enviarEmailReset } = require('./email');

// Configure EMAIL_TEST_DESTINO no .env para escolher quem receberá o teste.
// Se não configurar, envia para o próprio SMTP_USER.
const DESTINO = process.env.EMAIL_TEST_DESTINO || process.env.SMTP_USER;

async function main() {
  console.log('\n== Teste de e-mail — ITR ==\n');
  console.log('--- DEBUG DE AMBIENTE ---');
  console.log('Usuário Lido:', process.env.SMTP_USER);
  console.log('Tamanho da Senha Lida:', process.env.SMTP_PASS ? process.env.SMTP_PASS.length : 0, 'caracteres');
  console.log('-------------------------\n');   
    console.log('1) Verificando conexão SMTP com a Titan...');
    try {
        await verificarConexao();
        console.log('   [OK] Autenticou na Titan. Credenciais corretas.\n');
    } catch (err) {
        console.error('   [FALHOU] Não autenticou:', err.message);
        console.error('   Verifique SMTP_USER / SMTP_PASS no .env (senha DA CAIXA de e-mail).');
        console.error('   Se o erro falar em porta/timeout, confirme SMTP_HOST=smtp.titan.email e SMTP_PORT=587.\n');
        process.exit(1);
    }

    console.log(`2) Enviando e-mail de teste para: ${DESTINO} ...`);
    try {
        const link = 'http://localhost:3000/redefinir-senha.html?token=TESTE123';
        const info = await enviarEmailReset(DESTINO, link, 'Teste ITR');
        console.log('   [OK] E-mail enviado. messageId:', info.messageId);
        console.log('   Confira a caixa de entrada (e a de SPAM na primeira vez).\n');
    } catch (err) {
        console.error('   [FALHOU] Conectou mas não enviou:', err.message, '\n');
        process.exit(1);
    }

    console.log('== Pronto. Se o e-mail chegou, seguimos para as rotas. ==\n');
    process.exit(0);
}

main();