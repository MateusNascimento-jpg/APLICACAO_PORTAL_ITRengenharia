'use strict';

(function () {
    var csrf = '';
    var message = document.getElementById('message');
    var codeForm = document.getElementById('codeForm');
    var confirmForm = document.getElementById('confirmForm');
    var summary = document.getElementById('summary');

    async function call(route, body) {
        var response = await fetch('/api/propostas/confirmacao/' + route, {
            method: body ? 'POST' : 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
            body: body ? JSON.stringify(body) : undefined,
        });
        var result = await response.json();
        if (!response.ok || !result.sucesso)
            throw new Error(
                result.erro ||
                    'Não foi possível continuar. Reabra o link ou solicite um novo código no Portal.',
            );
        return result;
    }

    function details(proposal) {
        summary.replaceChildren();
        var rows = [
            ['Empresa', proposal.nomeCliente],
            ['CNPJ', proposal.cnpj],
            ['Proposta', proposal.numero],
            [
                'Valor',
                new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                    proposal.valor,
                ),
            ],
            ['Forma de pagamento', proposal.formaPagamento || 'Conforme proposta'],
            [
                'Prazo',
                proposal.prazoPagamentoDias == null
                    ? 'Conforme proposta'
                    : proposal.prazoPagamentoDias + ' dias após emissão da NF',
            ],
        ];
        rows.forEach(function (row) {
            var term = document.createElement('dt');
            var value = document.createElement('dd');
            term.textContent = row[0];
            value.textContent = row[1];
            summary.append(term, value);
        });
        summary.hidden = false;
    }

    async function start() {
        var token = window.location.hash.slice(1);
        history.replaceState(null, '', window.location.pathname);
        // Mantém somente a compatibilidade de links antigos já emitidos.
        // O fluxo novo é feito na área Propostas, sem página externa.
        if (!token) {
            message.textContent = 'Para confirmar uma nova proposta, acesse Propostas no Portal do Cliente e informe o código recebido por e-mail. Esta página atende somente links antigos.';
            return;
        }
        try {
            var result = token ? await call('abrir', { token: token }) : await call('contexto');
            token = '';
            csrf = result.csrf;
            details(result.proposal);
            document.getElementById('expiry').textContent =
                'Válido até ' +
                new Date(result.expiresAt).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                }) +
                '.';
            message.textContent =
                'Este link pertence ao fluxo anterior. Informe o código de oito dígitos associado à solicitação antiga. Para novos aceites, utilize a área de Propostas do Portal.';
            codeForm.hidden = false;
            document.getElementById('code').focus();
        } catch (error) {
            message.textContent = error.message;
        }
    }

    codeForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        var button = codeForm.querySelector('button');
        button.disabled = true;
        try {
            var result = await call('validar', {
                code: document.getElementById('code').value.trim(),
            });
            document.getElementById('code').value = '';
            details(result.proposal);
            codeForm.hidden = true;
            confirmForm.hidden = false;
            message.textContent =
                'Código validado. Deseja confirmar o aceite da proposta? Confira os dados e confirme expressamente abaixo.';
            document.getElementById('consent').focus();
        } catch (error) {
            message.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    });

    confirmForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        var button = confirmForm.querySelector('button');
        button.disabled = true;
        message.textContent = 'Registrando seu aceite…';
        try {
            await call('concluir', { consent: document.getElementById('consent').checked });
            confirmForm.hidden = true;
            message.textContent =
                'Proposta aceita com sucesso. Seu aceite foi registrado e o e-mail de confirmação será enviado. Você pode fechar esta página.';
        } catch (error) {
            message.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    });

    start();
})();
