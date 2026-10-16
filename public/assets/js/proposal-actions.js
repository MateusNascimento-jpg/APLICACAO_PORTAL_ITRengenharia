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

    async function accept(proposal, trigger) {
        var view = modal('Solicitar confirmação de aceite', trigger);
        view.content.append(
            element(
                'p',
                'Proposta ' +
                    proposal.numero +
                    '. Escolha o contato cadastrado que receberá o link de confirmação.',
            ),
        );
        try {
            var data = await json(
                await fetch(
                    '/api/propostas/' + encodeURIComponent(proposal.id) + '/contatos-aceite',
                    { credentials: 'same-origin', cache: 'no-store' },
                ),
            );
            if (!view.dialog.isConnected) return;
            var select = element('select');
            data.contacts.forEach(function (contact) {
                var option = element('option', contact.label);
                option.value = contact.key;
                select.appendChild(option);
            });
            var submit = element(
                'button',
                'Gerar código e solicitar e-mail',
                'proposta-modal-primario',
            );
            submit.type = 'button';
            view.content.append(label('Contato autorizado', select), submit);
            submit.addEventListener('click', async function () {
                submit.disabled = true;
                view.message.textContent = 'Registrando solicitação…';
                try {
                    var result = await json(
                        await ITR.apiFetch(
                            '/api/propostas/' +
                                encodeURIComponent(proposal.id) +
                                '/aceite/solicitar',
                            {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ recipientKey: select.value }),
                            },
                        ),
                    );
                    view.content.replaceChildren();
                    view.content.append(
                        element(
                            'p',
                            'Copie o código abaixo. Abra o link recebido por e-mail, informe o código e confirme o aceite naquela página.',
                        ),
                    );
                    var code = element('input', '', 'proposta-codigo');
                    code.value = result.code;
                    code.readOnly = true;
                    code.setAttribute('aria-label', 'Código temporário de confirmação');
                    var copy = element('button', 'Copiar código', 'proposta-modal-primario');
                    copy.type = 'button';
                    copy.addEventListener('click', async function () {
                        try {
                            await navigator.clipboard.writeText(code.value);
                            view.message.textContent = 'Código copiado.';
                        } catch (_) {
                            code.focus();
                            code.select();
                            view.message.textContent = 'Selecione e copie o código manualmente.';
                        }
                    });
                    view.content.append(
                        code,
                        copy,
                        element(
                            'p',
                            'Válido até ' +
                                new Date(result.expiresAt).toLocaleTimeString('pt-BR', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                }) +
                                '. Se precisar de outro código, faça uma nova solicitação após um minuto. O anterior será invalidado.',
                        ),
                    );
                    view.message.textContent =
                        'Solicitação registrada. O e-mail será enviado em seguida; confira também o spam. A proposta ainda não foi aceita.';
                } catch (error) {
                    view.message.textContent = error.message;
                    submit.disabled = false;
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
