'use strict';

window.ITRProposals = (function () {
    function element(tag, text, className) {
        var node = document.createElement(tag);
        if (text) node.textContent = text;
        if (className) node.className = className;
        return node;
    }

    // "4 min 05 s": mesmo formato das mensagens do servidor.
    function waitText(ms) {
        var total = Math.max(1, Math.ceil(ms / 1000));
        var minutes = Math.floor(total / 60);
        var seconds = total % 60;
        if (!minutes) return seconds + ' s';
        return minutes + ' min ' + (seconds < 10 ? '0' : '') + seconds + ' s';
    }

    // Retry-After aceita segundos ou data HTTP (RFC 9110); o corpo, quando
    // presente, traz retryAfterSeconds com o mesmo valor.
    function retryAfterMs(response, body, now) {
        if (body && isFinite(body.retryAfterSeconds) && body.retryAfterSeconds > 0)
            return body.retryAfterSeconds * 1000;
        var header = response && response.headers && response.headers.get('Retry-After');
        if (!header) return 0;
        if (/^\s*\d+\s*$/.test(header)) return Number(header) * 1000;
        var date = Date.parse(header);
        return isFinite(date) ? Math.max(0, date - now) : 0;
    }

    async function json(response) {
        var body = null;
        try { body = await response.json(); } catch (_) { body = null; }
        if (!response.ok || !body || !body.sucesso) {
            var error = new Error((body && body.erro) || 'Não foi possível concluir a solicitação.');
            error.status = response.status;
            error.codigo = body && body.codigo;
            if (response.status === 429) error.retryAfterMs = retryAfterMs(response, body, Date.now());
            throw error;
        }
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
        var timers = [];
        dialog.addEventListener('close', function () {
            timers.forEach(clearInterval);
            timers.length = 0;
            dialog.remove();
            if (trigger && trigger.isConnected) trigger.focus();
        });
        document.body.appendChild(dialog);
        dialog.showModal();
        return { dialog: dialog, content: content, message: message, timers: timers };
    }

    function label(text, input) {
        var wrapper = element('label', '', 'proposta-modal-campo');
        wrapper.append(element('span', text), input);
        return wrapper;
    }

    function hour(timestamp) {
        return new Date(timestamp).toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        });
    }

    function remaining(ms) {
        var minutes = Math.max(1, Math.ceil(ms / 60000));
        var hours = Math.floor(minutes / 60);
        minutes = minutes % 60;
        return hours ? hours + ' h ' + (minutes < 10 ? '0' : '') + minutes + ' min' : minutes + ' min';
    }

    var DELIVERY = {
        queued: 'Solicitação registrada. Verifique a caixa de entrada e a pasta de spam de ',
        sent: 'E-mail com o código enviado para ',
        uncertain: 'O envio está em conferência. Se a mensagem não chegar em alguns minutos, solicite um novo código. Destinatário: ',
        failed: 'Não foi possível entregar o e-mail com o código. Solicite um novo código; esta falha não conta no limite de pedidos. Destinatário: '
    };

    // Fluxo de aceite em etapas: contato → código (8 dígitos, enviado só por
    // e-mail) → consentimento expresso. O estado vive no servidor; fechar e
    // reabrir a janela retoma o código vigente sem gerar outro. Nenhum código
    // é guardado no navegador.
    async function accept(proposal, trigger, refresh) {
        var view = modal('Confirmação de aceite', trigger);
        var id = encodeURIComponent(proposal.id);
        var base = '/api/propostas/' + id + '/aceite/';
        var intro = element('p', 'Selecione um contato comercial cadastrado para receber o código de oito dígitos. O código terá validade de 2 horas e só poderá ser utilizado uma vez.');
        var status = element('p', '', 'proposta-modal-estado');
        status.setAttribute('aria-live', 'polite');
        status.hidden = true;
        var codeArea = element('div');
        var requestArea = element('div');
        view.content.append(intro, status, codeArea, requestArea);
        var contacts = [];
        var current = null;
        var expiry = 0;
        var nextAllowed = 0;
        var polling = 0;
        var waitMessage = '';

        function every(ms, fn) {
            var timer = setInterval(fn, ms);
            view.timers.push(timer);
            return timer;
        }
        function stop(timer) {
            clearInterval(timer);
            var index = view.timers.indexOf(timer);
            if (index >= 0) view.timers.splice(index, 1);
        }

        async function loadState() {
            var data = await json(await fetch(base + 'estado', { credentials: 'same-origin', cache: 'no-store' }));
            var offset = Date.now() - (isFinite(data.now) ? data.now : Date.now());
            if (data.challenge) data.challenge.localExpiresAt = data.challenge.expiresAt + offset;
            data.localNextRequestAt = data.nextRequestAt ? data.nextRequestAt + offset : 0;
            return data;
        }

        function showStatus() {
            if (!current) return;
            var left = expiry - Date.now();
            if (left <= 0) {
                status.textContent = 'O código enviado para ' + current.recipientLabel + ' expirou. Solicite um novo código.';
                current = null;
                codeArea.replaceChildren();
                renderRequest();
                return;
            }
            var text = 'Código solicitado para ' + current.recipientLabel + ', válido até ' + hour(expiry) +
                ' (restam ' + remaining(left) + ').';
            if (current.attemptsRemaining < 5)
                text += ' Tentativas restantes: ' + current.attemptsRemaining + '.';
            status.textContent = text;
            status.hidden = false;
        }

        function showDelivery() {
            if (!current) return;
            view.message.textContent = (DELIVERY[current.delivery] || DELIVERY.queued) + current.recipientLabel + '.';
        }

        // Atualiza o estado do envio (fila → enviado/falha) por até ~1 minuto.
        function watchDelivery() {
            if (polling) stop(polling);
            var rounds = 0;
            polling = every(4000, async function () {
                rounds += 1;
                if (!view.dialog.isConnected || rounds > 15 || !current) return stop(polling);
                try {
                    var data = await loadState();
                    if (!data.challenge || !current) return stop(polling);
                    current.delivery = data.challenge.delivery;
                    showDelivery();
                    if (data.challenge.delivery !== 'queued') {
                        stop(polling);
                        if (data.challenge.delivery === 'failed') {
                            nextAllowed = data.localNextRequestAt;
                            renderRequest();
                        }
                    }
                } catch (_) { /* nova tentativa no próximo ciclo */ }
            });
        }

        function renderRequest() {
            requestArea.replaceChildren();
            if (!contacts.length) return;
            var select = element('select');
            select.required = true;
            contacts.forEach(function (contact) {
                var option = element('option', contact.label);
                option.value = contact.key;
                if (current && current.recipientKey === contact.key) option.selected = true;
                select.appendChild(option);
            });
            var replacing = Boolean(current);
            var send = element('button', replacing ? 'Solicitar novo código' : 'Enviar código por e-mail',
                replacing ? 'proposta-modal-secundario' : 'proposta-modal-primario');
            send.type = 'button';
            var wait = element('p', '', 'proposta-modal-espera');
            wait.hidden = true;
            requestArea.append(label('E-mail autorizado', select));
            if (replacing)
                requestArea.append(element('p', 'Já recebeu o código? Digite-o acima. Um novo código substitui o anterior, que deixará de valer.', 'proposta-modal-nota'));
            requestArea.append(send, wait);

            var countdown = 0;
            function tick() {
                var left = nextAllowed - Date.now();
                if (left <= 0) {
                    stop(countdown);
                    wait.hidden = true;
                    send.disabled = false;
                    // A mensagem de espera (429) deixa de valer quando o prazo acaba.
                    if (waitMessage && view.message.textContent === waitMessage) view.message.textContent = '';
                    return;
                }
                send.disabled = true;
                wait.hidden = false;
                wait.textContent = 'Novo código disponível em ' + waitText(left) + '.';
            }
            if (nextAllowed > Date.now()) {
                countdown = every(1000, tick);
                tick();
            }

            send.addEventListener('click', async function () {
                if (send.disabled) return;
                if (replacing && !window.confirm('O código anterior deixará de valer. Deseja solicitar um novo código?')) return;
                send.disabled = true;
                view.message.textContent = 'Solicitando código…';
                try {
                    var result = await json(await ITR.apiFetch(base + 'solicitar', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ recipientKey: select.value })
                    }));
                    var state = await loadState().catch(function () { return null; });
                    current = state && state.challenge ? state.challenge : {
                        recipientKey: select.value, recipientLabel: result.recipientLabel,
                        localExpiresAt: result.expiresAt, attemptsRemaining: 5, delivery: 'queued'
                    };
                    expiry = current.localExpiresAt;
                    nextAllowed = state ? state.localNextRequestAt : result.nextRequestAt;
                    renderCode();
                    renderRequest();
                    showStatus();
                    showDelivery();
                    if (result.replaced) view.message.textContent += ' O código anterior foi substituído e não vale mais.';
                    watchDelivery();
                } catch (error) {
                    if (error.status === 429 && error.retryAfterMs) {
                        nextAllowed = Date.now() + error.retryAfterMs;
                        view.message.textContent = waitMessage = error.message;
                        renderRequest();
                        return;
                    }
                    view.message.textContent = error.message;
                    send.disabled = false;
                }
            });
        }

        function renderCode() {
            codeArea.replaceChildren();
            if (!current) return;
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
                if (!/^[0-9]{8}$/.test(code.value)) {
                    view.message.textContent = 'Digite os oito dígitos recebidos por e-mail.';
                    return;
                }
                check.disabled = true;
                view.message.textContent = 'Validando código…';
                try {
                    var checked = await json(await ITR.apiFetch(base + 'validar', {
                        method:'POST', headers:{'Content-Type':'application/json'},
                        body:JSON.stringify({ code:code.value })
                    }));
                    code.value = '';
                    renderConsent(checked);
                } catch (error) {
                    view.message.textContent = error.message;
                    check.disabled = false;
                    if (error.status === 429) return;
                    // Atualiza tentativas restantes ou retorna à solicitação.
                    try {
                        var state = await loadState();
                        current = state.challenge;
                        nextAllowed = state.localNextRequestAt;
                        if (current) expiry = current.localExpiresAt;
                        else { codeArea.replaceChildren(); renderRequest(); }
                        showStatus();
                    } catch (_) {}
                }
            });
            codeArea.append(form);
            code.focus();
        }

        function done() {
            view.content.replaceChildren(element('p', 'Aceite confirmado. Sua decisão foi registrada e a equipe ITR dará continuidade ao processo comercial.'));
        }

        function renderConsent(checked) {
            view.timers.forEach(clearInterval);
            view.timers.length = 0;
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
                    try {
                        await json(await ITR.apiFetch(base + 'confirmar', {
                            method: 'POST', headers: { 'Content-Type':'application/json' },
                            body: JSON.stringify({ confirmation: checked.confirmation, consent: true })
                        }));
                    } catch (error) {
                        // Resposta perdida ou decisão em conferência: consulta o estado real
                        // antes de oferecer nova tentativa (o servidor não duplica o aceite).
                        if (error.status && error.status < 500 && error.codigo !== 'DECISION_UNCERTAIN') throw error;
                        var state = await loadState().catch(function () { return null; });
                        if (!(state && state.decision && state.decision.status === 'Aceita' && state.decision.state === 'done'))
                            throw error;
                    }
                    done();
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
        }

        try {
            // Estado primeiro: proposta já decidida não consulta contatos nem oferece código.
            var state = await loadState();
            if (!view.dialog.isConnected) return;
            if (state.decision) {
                intro.textContent = state.decision.state === 'done'
                    ? 'Esta proposta já possui decisão registrada (' + state.decision.status + ').'
                    : 'A decisão desta proposta está em conferência. Aguarde a atualização.';
                return;
            }
            contacts = (await json(await fetch('/api/propostas/' + id + '/contatos-aceite',
                { credentials: 'same-origin', cache: 'no-store' }))).contacts;
            if (!view.dialog.isConnected) return;
            if (!contacts.length) throw new Error('Nenhum contato comercial disponível para esta proposta.');
            current = state.challenge;
            nextAllowed = state.localNextRequestAt;
            if (current) {
                expiry = current.localExpiresAt;
                intro.textContent = 'Digite o código de oito dígitos enviado por e-mail. Não é necessário solicitar outro código enquanto este estiver válido.';
                renderCode();
                showStatus();
                showDelivery();
                if (current.delivery === 'queued') watchDelivery();
            }
            renderRequest();
            every(30000, showStatus);
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

    return { accept: accept, reject: reject, waitText: waitText, retryAfterMs: retryAfterMs };
})();
