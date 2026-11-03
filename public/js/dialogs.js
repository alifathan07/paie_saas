(() => {
    const dialog = document.createElement('dialog');
    dialog.className = 'app-dialog';
    dialog.setAttribute('aria-labelledby', 'app-dialog-title');
    dialog.setAttribute('aria-describedby', 'app-dialog-message');
    dialog.innerHTML = `<div class="app-dialog-content">
        <div class="app-dialog-icon" aria-hidden="true">!</div>
        <h2 id="app-dialog-title"></h2>
        <p id="app-dialog-message"></p>
        <div class="app-dialog-actions">
            <button type="button" class="app-dialog-cancel">Annuler</button>
            <button type="button" class="app-dialog-abort" hidden>Annuler</button>
            <button type="button" class="app-dialog-confirm">Compris</button>
        </div>
    </div>`;
    document.body.append(dialog);
    const title = dialog.querySelector('h2');
    const message = dialog.querySelector('p');
    const cancel = dialog.querySelector('.app-dialog-cancel');
    const abort = dialog.querySelector('.app-dialog-abort');
    const confirm = dialog.querySelector('.app-dialog-confirm');
    let queue = Promise.resolve();
    function open(text, options = {}) {
        const task = queue.then(() => new Promise(resolve => {
            const previousFocus = document.activeElement;
            title.textContent = options.title || (options.confirm ? 'Confirmer cette action' : 'Information');
            message.textContent = text;
            cancel.hidden = !options.confirm;
            cancel.textContent = options.cancelLabel || 'Annuler';
            abort.hidden = !options.abortLabel;
            abort.textContent = options.abortLabel || 'Annuler';
            confirm.textContent = options.confirmLabel || (options.confirm ? 'Confirmer' : 'Compris');
            dialog.classList.toggle('is-danger', Boolean(options.danger));
            let accepted = false;
            let choice = null;
            const close = result => {
                if (result !== undefined) choice = result;
                if (dialog.open) dialog.close('app-dialog');
            };
            const onConfirm = event => { event.preventDefault(); accepted = true; close(true); };
            const onCancel = event => { event.preventDefault(); close(false); };
            const onAbort = event => { event.preventDefault(); close(null); };
            const onClose = () => {
                confirm.removeEventListener('click', onConfirm);
                cancel.removeEventListener('click', onCancel);
                abort.removeEventListener('click', onAbort);
                if (previousFocus?.isConnected) previousFocus.focus();
                resolve(options.mode === 'choice' ? choice : accepted);
            };
            confirm.addEventListener('click', onConfirm);
            cancel.addEventListener('click', onCancel);
            abort.addEventListener('click', onAbort);
            dialog.addEventListener('close', onClose, { once: true });
            dialog.showModal();
            (options.confirm ? cancel : confirm).focus();
        }));
        queue = task.catch(() => {});
        return task;
    }
    window.AppDialog = {
        alert: (text, options) => open(text, options),
        confirm: (text, options) => open(text, { ...options, confirm: true }),
        choice: (text, options) => open(text, { ...options, confirm: true, mode: 'choice' }),
    };
    const approved = new WeakSet();
    document.addEventListener('submit', async event => {
        const form = event.target;
        const confirmation = event.submitter?.matches('[data-confirm]') ? event.submitter : form;
        if (!confirmation.matches('[data-confirm]')) return;
        if (approved.has(form)) { approved.delete(form); return; }
        event.preventDefault();
        if (form.dataset.confirmPending) return;
        const submitter = event.submitter;
        form.dataset.confirmPending = 'true';
        const accepted = await window.AppDialog.confirm(confirmation.dataset.confirm, {
            title: confirmation.dataset.confirmTitle,
            confirmLabel: confirmation.dataset.confirmLabel,
            danger: confirmation.dataset.confirmDanger === 'true',
        });
        delete form.dataset.confirmPending;
        if (accepted && form.isConnected) {
            approved.add(form);
            form.requestSubmit(submitter || undefined);
            approved.delete(form);
        }
    });
    const notice = document.querySelector('#bulletin-period-message');
    if (notice) window.AppDialog.alert(notice.textContent.trim(), { title: 'Période de paie bloquée', confirmLabel: 'Revenir au mois actif' });
    const periodChangeNotice = document.querySelector('#period-change-message');
    if (periodChangeNotice) window.AppDialog.alert(periodChangeNotice.textContent.trim(), { title: 'Période de paie bloquée', confirmLabel: 'Revenir au mois actif' });
    const bulletinError = document.querySelector('#bulletin-error-message');
    if (bulletinError) window.AppDialog.alert(bulletinError.textContent.trim(), { title: 'Modification impossible', danger: true, confirmLabel: 'Compris' });
    const editionError = document.querySelector('#edition-error-message');
    if (editionError) window.AppDialog.alert(editionError.textContent.trim(), { title: 'Aucune donnée disponible', danger: true, confirmLabel: 'Compris' });
    document.querySelectorAll('a[data-pdf-export]').forEach(link => link.addEventListener('click', async event => {
        event.preventDefault();
        if (link.dataset.loading === 'true') return;
        link.dataset.loading = 'true';
        try {
            const response = await fetch(link.href, { credentials: 'same-origin' });
            if (!response.ok) {
                const message = (await response.text()).trim() || 'Impossible de générer le PDF.';
                await window.AppDialog.alert(message, { title: 'Aucune donnée disponible', danger: true, confirmLabel: 'Compris' });
                return;
            }
            const blob = await response.blob();
            const disposition = response.headers.get('content-disposition') || '';
            const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'export.pdf';
            const url = URL.createObjectURL(blob);
            const download = document.createElement('a');
            download.href = url;
            download.download = filename;
            download.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            await window.AppDialog.alert('Impossible de générer le PDF.', { title: 'Erreur', danger: true, confirmLabel: 'Compris' });
        } finally {
            delete link.dataset.loading;
        }
    }));
})();
