/**
 * email.js — ITR Engenharia
 * -------------------------------------------------------------
 * Módulo único de envio de e-mail. Usa nodemailer + SMTP da Titan
 * (naoresponda@itr.eng.br). Lê tudo do .env, então trocar de provedor
 * no futuro é só mudar o .env — este arquivo não muda.
 *
 * Instale a dependência (uma vez, na pasta do backend):
 *   npm install nodemailer
 * -------------------------------------------------------------
 */

const nodemailer = require('nodemailer');
require('dotenv').config();

// Define a porta vinda do .env ou assume 587 como padrão
const port = Number(process.env.SMTP_PORT) || 587;

// Transporte SMTP Dinâmico
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,           // smtp.titan.email
    port: port,
    secure: port === 465,                  // SE for 465 usa SSL direto (true), se for 587 usa STARTTLS (false)
    auth: {
        user: process.env.SMTP_USER,        // naoresponda@itr.eng.br
        pass: process.env.SMTP_PASS         // senha da caixa
    }
});
/**
 * verificarConexao — testa se as credenciais SMTP autenticam.
 * Útil no boot / no teste_email.js. Não envia nada.
 */
async function verificarConexao() {
    await transporter.verify();
    return true;
}

/**
 * enviarEmailReset — dispara o e-mail de recuperação de senha.
 * @param {string} destino - e-mail do usuário
 * @param {string} link    - URL completa de redefinição (com o token)
 * @param {string} [nome]  - nome/empresa para saudação (opcional)
 */
async function enviarEmailReset(destino, link, nome) {
    const saudacao = nome ? `Olá, ${nome}` : 'Olá';

    const html = `
    <div style="margin:0;padding:24px;background:#0f1420;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
      <div style="max-width:480px;margin:0 auto;background:#141b2b;border:1px solid #263149;border-radius:14px;overflow:hidden;">
        <div style="background:#0d1220;padding:24px 28px;border-bottom:1px solid #263149;">
          <span style="color:#e6ecf5;font-size:18px;font-weight:600;letter-spacing:.5px;">ITR ENGENHARIA</span>
        </div>
        <div style="padding:28px;">
          <h2 style="color:#e6ecf5;font-size:20px;margin:0 0 12px;">Redefinição de senha</h2>
          <p style="color:#aab6cc;font-size:15px;line-height:1.6;margin:0 0 20px;">
            ${saudacao}. Recebemos um pedido para redefinir a senha da sua conta no Portal do Cliente.
            Clique no botão abaixo para criar uma nova senha. Este link expira em 1 hora.
          </p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${link}" style="display:inline-block;background:#3b82f6;color:#ffffff;
               text-decoration:none;font-size:16px;font-weight:600;padding:14px 32px;border-radius:10px;">
               Redefinir minha senha
            </a>
          </div>
          <p style="color:#7c89a3;font-size:13px;line-height:1.6;margin:20px 0 0;">
            Se você não pediu isso, pode ignorar este e-mail com segurança — sua senha continua a mesma.
          </p>
          <p style="font-size:12px;color:#6f7fa0;margin:16px 0 0;word-break:break-all;">
            Se o botão não funcionar, copie e cole este endereço no navegador:<br>
            <span style="color:#6f7fa0;">${link}</span>
          </p>
        </div>
        <div style="background:#0d1220;padding:16px 28px;border-top:1px solid #263149;">
          <span style="font-size:12px;color:#5f6b83;">
            SCIA Quadra 14 Conjunto 6 Lote 05 – Parte A - Zona Industrial, Brasília - DF, 71250-130 · Este é um e-mail automático, não responda.
          </span>
        </div>
      </div>
    </div>`;

    const info = await transporter.sendMail({
        from: `"ITR Engenharia" <${process.env.SMTP_USER}>`,
        to: destino,
        subject: 'Redefinição de senha — Portal ITR Engenharia',
        html: html,
        text: `${saudacao}. Para redefinir sua senha, acesse: ${link} (expira em 1 hora). Se não foi você, ignore este e-mail.`
    });

    return info;
}

module.exports = { enviarEmailReset, verificarConexao };