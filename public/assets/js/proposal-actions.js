'use strict';

window.ITRProposals = (function () {
    function element(tag, text, className) {
        var node = document.createElement(tag);
        if (text) node.textContent = text;
        if (className) node.className = className;
        return node;
    }

    async function json(response) {
        var body = await response.json();
        if (!response.ok || !body.sucesso)
            throw new Error(body.erro || 'Não foi possível concluir a solicitação.');
        return body;
    }

    function modal(title, trigger) {
        var dialog = element('dialog', '', 'proposta-modal');
        var heading = element('h2', title);
        heading.id = 'proposta-modal-titulo';
        dialog.setAttribute('aria-labelledby', heading.id);
        dialog.appendChild(heading);
        var content = element('div', '', 'proposta-modal-conteudo');
        var message = element('p', '', 'proposta-modal-mensagem');
        message.setAttribute('role', 'status');
        var close = element('button', 'Fechar', 'proposta-modal-secundario');
        close.type = 'button';
        close.addEventListener('click', function () {
            dialog.close();
        });
        dialog.append(content, message, close);
        dialog.addEventListener('close', function () {
            dialog.remove();
            if (trigger && trigger.isConnected) trigger.focus();
        });
        document.body.appendChild(dialog);
        dialog.showModal();
        return { dialog: dialog, content: content, message: message };
    }

    function label(text, input) {
        var wrapper = element('label', '', 'proposta-modal-campo');
        wrapper.append(element('span', text), input);
        return wrapper;
    }

    async function accept(proposal, trigger, refresh) {
        var view = modal('Confirmação de aceite', trigger);
        var base = '/api/propostas/' + encodeURIComponent(proposal.id) + '/aceite/';
        view.content.append(element('p', 'Selecione um contato comercial cadastrado para receber o código de oito dígitos. O código terá validade de 2 horas e só poderá ser utilizado uma vez.'));
        try {
            var data = await json(await fetch('/api/propostas/' + encodeURIComponent(proposal.id) + '/contatos-aceite',
                { credentials: 'same-origin', cache: 'no-store' }));
            if (!view.dialog.isConnected) return;
            if (!data.contacts.length) throw new Error('Nenhum contato comercial disponível para esta proposta.');
            var select = element('select');
            select.required = true;
            data.contacts.forEach(function (contact) {
                var option = element('option', contact.label);
                option.value = contact.key;
                select.appendChild(option);
            });
            var send = element('button', 'Enviar código por e-mail', 'proposta-modal-primario');
            send.type = 'button';
            view.content.append(label('E-mail autorizado', select), send);
            send.addEventListener('click', async function () {
                send.disabled = true;
                view.message.textContent = 'Solicitando código…';
                try {
                    var result = await json(await ITR.apiFetch(base + 'solicitar', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ recipientKey: select.value })
                    }));
                    view.content.replaceChildren();
                    var expiry = element('p', 'O código foi solicitado e será válido até ' +
                        new Date(result.expiresAt).toLocaleString('pt-BR', {
                            day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'
                        }) + '. Consulte seu e-mail autorizado e digite os oito dígitos abaixo.');
                    var form = element('form');
                    var code = element('input', '', 'proposta-codigo');
                    code.required = true;
                    code.maxLength = 8;
                    code.minLength = 8;
                    code.pattern = '[0-9]{8}';
                    code.inputMode = 'numeric';
                    code.autocomplete = 'one-time-code';
                    code.setAttribute('aria-label', 'Código temporário de oito dígitos');
                    var check = element('button', 'Validar código', 'proposta-modal-primario');
                    check.type = 'submit';
                    form.append(label('Código de aceite', code), check);
                    form.addEventListener('submit', async function (event) {
                        event.preventDefault();
                        if (!/^[0-9]{8}$/.test(code.value)) return;
                        check.disabled = true;
                        view.message.textContent = 'Validando código…';
                        try {
                            var checked = await json(await ITR.apiFetch(base + 'validar', {
                                method:'POST', headers:{'Content-Type':'application/json'},
                                body:JSON.stringify({ code:code.value })
                            }));
                            code.value = '';
                            view.content.replaceChildren();
                            view.content.append(element('p', 'Código validado. Confira os dados comerciais e manifeste expressamente sua concordância com a proposta ' + proposal.numero + '.'));
                            var consentForm = element('form');
                            var consent = element('input');
                            consent.type = 'checkbox';
                            consent.required = true;
                            consentForm.append(label('Li as condições comerciais e concordo com o aceite desta proposta.', consent));
                            var confirm = element('button', 'Confirmar aceite da proposta', 'proposta-modal-primario');
                            confirm.type = 'submit';
                            consentForm.appendChild(confirm);
                            consentForm.addEventListener('submit', async function (event) {
                                event.preventDefault();
                                if (!consent.checked) return;
                                confirm.disabled = true;
                                view.message.textContent = 'Registrando seu aceite…';
                                try {
                                    await json(await ITR.apiFetch(base + 'confirmar', {
                                        method: 'POST', headers: { 'Content-Type':'application/json' },
                                        body: JSON.stringify({ confirmation: checked.confirmation, consent: true })
                                    }));
                                    view.content.replaceChildren(element('p', 'Aceite confirmado. Sua decisão foi registrada e a equipe ITR dará continuidade ao processo comercial.'));
                                    view.message.textContent = 'Atualizando propostas e documentos…';
                                    // Recarrega do servidor sem exibir dados desatualizados ou
                                    // assumir que o comprovante esteja disponível antes da persistência.
                                    if (typeof refresh === 'function') {
                                        await refresh();
                                    }
                                    view.message.textContent = 'A confirmação por e-mail será processada. Seus documentos estarão disponíveis assim que forem registrados.';
                                } catch (error) {
                                    view.message.textContent = error.message;
                                    confirm.disabled = false;
                                }
                            });
                            view.content.append(consentForm);
                            view.message.textContent = '';
                            consent.focus();
                        } catch (error) {
                            view.message.textContent = error.message;
                            check.disabled = false;
                        }
                    });
                    view.content.append(expiry, form);
                    view.message.textContent = 'Mensagem encaminhada à fila. Confira também sua pasta de spam.';
                    code.focus();
                } catch (error) {
                    view.message.textContent = error.message;
                    send.disabled = false;
                }
            });
        } catch (error) {
            view.message.textContent = error.message;
        }
    }

    function reject(proposal, trigger, refresh) {
        var view = modal('Rejeição da proposta', trigger);
        view.dialog.classList.add('proposta-modal-rejeicao');
        view.content.append(
            element(
                'p',
                'Proposta ' +
                    proposal.numero +
                    '. Para concluir a rejeição, informe no campo abaixo o principal motivo da sua decisão. Descreva, de forma objetiva, quais condições comerciais ou aspectos do serviço não atenderam às suas necessidades. Sua resposta será registrada para análise da equipe comercial e poderá contribuir para o aperfeiçoamento de futuras propostas.',
            ),
        );
        var form = element('form');
        var reason = element('textarea');
        reason.required = true;
        reason.minLength = 5;
        reason.maxLength = 1000;
        reason.rows = 3;
        var submit = element(
            'button',
            'Enviar feedback e rejeitar proposta',
            'proposta-modal-rejeitar',
        );
        submit.type = 'submit';
        form.append(
            label('Motivo da rejeição (obrigatório)', reason),
            submit,
        );
        form.addEventListener('submit', async function (event) {
            event.preventDefault();
            submit.disabled = true;
            view.message.textContent = 'Registrando decisão…';
            try {
                await json(
                    await ITR.apiFetch(
                        '/api/propostas/' + encodeURIComponent(proposal.id) + '/rejeitar',
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                reason: reason.value.trim(),
                            }),
                        },
                    ),
                );
                view.content.replaceChildren(
                    element('p', 'A proposta foi rejeitada e seu motivo foi registrado.'),
                );
                view.message.textContent = '';
                refresh();
            } catch (error) {
                view.message.textContent = error.message;
                submit.disabled = false;
            }
        });
        view.content.appendChild(form);
        reason.focus();
    }

    return { accept: accept, reject: reject };
})();
