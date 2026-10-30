(() => {
    const tableWrapper = document.querySelector('#bulletins-table-wrapper');
    const topScrollbar = document.querySelector('#bulletins-scrollbar');
    const bulletinTable = document.querySelector('#bulletins-table');
    if (tableWrapper && topScrollbar && bulletinTable) {
        const scrollbarContent = topScrollbar.firstElementChild;
        const syncWidth = () => { scrollbarContent.style.width = `${bulletinTable.scrollWidth}px`; };
        let syncing = false;
        topScrollbar.addEventListener('scroll', () => {
            if (syncing) return;
            syncing = true;
            tableWrapper.scrollLeft = topScrollbar.scrollLeft;
            syncing = false;
        });
        tableWrapper.addEventListener('scroll', () => {
            if (syncing) return;
            syncing = true;
            topScrollbar.scrollLeft = tableWrapper.scrollLeft;
            syncing = false;
        });
        new ResizeObserver(syncWidth).observe(bulletinTable);
        syncWidth();
    }
    const maskDialog = document.querySelector('#mask-dialog');
    const maskForm = document.querySelector('#mask-dialog-form');
    const maskMessage = document.querySelector('#mask-dialog-message');
    document.querySelectorAll('.mask-bulletin-button').forEach(button => {
        button.addEventListener('click', () => {
            maskForm.action = button.dataset.action;
            maskMessage.textContent = `Choisissez quand masquer le bulletin de ${button.dataset.employee}.`;
            maskDialog.showModal();
        });
    });
    document.querySelector('#mask-dialog-cancel')?.addEventListener('click', () => maskDialog.close());
    maskForm?.addEventListener('submit', event => {
        const submitter = event.submitter;
        if (!submitter?.name) return;
        event.preventDefault();
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = maskForm.action;
        [['month', document.querySelector('#sel-month').value], ['year', document.querySelector('#inp-year').value], ['scope', submitter.value]]
            .forEach(([name, value]) => { const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.append(input); });
        document.body.append(form);
        form.submit();
    });
    const money = value => `${Number(value).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
    let dirtyRows = 0;
    window.addEventListener('beforeunload', event => {
        if (dirtyRows) { event.preventDefault(); event.returnValue = ''; }
    });
    document.querySelectorAll('.bulletin-row').forEach(row => {
        row.addEventListener('click', event => {
            if (event.target.closest('a, button, input, form, select, details, summary')) return;
            window.location.href = row.dataset.href;
        });
        const form = row.querySelector('.worked-days-form');
        if (!form) return;
        const input = form.elements.workedDays || form.elements.workedHours;
        const message = form.querySelector('.worked-days-message');
        const sbi = row.querySelector('[data-payroll-sbi]');
        const net = row.querySelector('[data-payroll-net]');
        let savedWorkingTime = input.value;
        let savedAmounts = { sbi: sbi.textContent, net: net.textContent };
        let dirty = false;
        let sequence = 0;
        let timer;
        let pending;
        let saving = false;
        function setDirty(value) {
            if (dirty !== value) dirtyRows += value ? 1 : -1;
            dirty = value;
        }
        function restoreAmounts() {
            sbi.textContent = savedAmounts.sbi;
            net.textContent = savedAmounts.net;
        }
        async function calculate(save = false) {
            if (!input.checkValidity() || saving) return;
            const version = ++sequence;
            pending?.abort();
            pending = new AbortController();
            const body = new URLSearchParams(new FormData(form));
            if (save) { saving = true; input.readOnly = true; }
            message.textContent = save ? 'Enregistrement…' : 'Calcul…';
            try {
                const response = await fetch(save ? form.action : `${form.action}?${body}`, {
                    method: save ? 'POST' : 'GET',
                    headers: { Accept: 'application/json' },
                    ...(save ? { body } : {}),
                    signal: pending.signal,
                });
                const result = await response.json();
                if (version !== sequence) return;
                if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible de mettre à jour le bulletin.');
                sbi.textContent = money(result.payroll.sbi);
                net.textContent = money(result.payroll.netAPayer);
                if (save) {
                    savedWorkingTime = input.value;
                    savedAmounts = { sbi: sbi.textContent, net: net.textContent };
                    setDirty(false);
                }
                message.textContent = save ? 'Enregistré' : 'Aperçu · non enregistré';
            } catch (error) {
                if (version !== sequence || error.name === 'AbortError') return;
                restoreAmounts();
                message.textContent = error.message || 'Erreur de connexion. Veuillez réessayer.';
            } finally {
                if (version === sequence) {
                    saving = false;
                    input.readOnly = false;
                }
            }
        }
        input.addEventListener('input', () => {
            clearTimeout(timer);
            ++sequence;
            pending?.abort();
            setDirty(input.value !== savedWorkingTime);
            restoreAmounts();
            if (!input.checkValidity()) {
                message.textContent = 'Saisissez une valeur de temps de travail valide.';
            } else if (dirty) {
                message.textContent = 'Modification non enregistrée…';
                timer = setTimeout(() => calculate(), 300);
            } else {
                message.textContent = '';
            }
        });
        function saveDays() {
            clearTimeout(timer);
            if (dirty && !saving && input.checkValidity()) calculate(true);
        }
        // Tab keeps normal focus navigation; leaving the field saves the edit.
        input.addEventListener('blur', saveDays);
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                if (form.reportValidity()) saveDays();
            }
        });
        form.addEventListener('submit', event => {
            event.preventDefault();
            if (form.reportValidity()) saveDays();
        });
    });
    const listMoney = value => `${Number(value || 0).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
    document.querySelectorAll('.bulletin-components-form').forEach(form => {
        let liveTimer;
        const formControls = () => document.querySelectorAll(`[form="${form.id}"]`);
        const refreshLiveTotals = async () => {
            const body = new URLSearchParams(new FormData(form));
            const employeeId = form.id.replace('bulletin-form-', '');
            const response = await fetch(`/bulletins/${employeeId}/calculate?${body}`, { headers: { Accept: 'application/json' } });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Calcul impossible.');
            const row = document.querySelector(`[data-href^="/bulletins/${employeeId}"]`);
            row?.querySelector('[data-payroll-sbi]')?.replaceChildren(document.createTextNode(`${listMoney(result.sbi)}`));
            const netCell = row?.querySelector('[data-payroll-net]');
            if (netCell) {
                netCell.replaceChildren(document.createElement('strong'));
                netCell.querySelector('strong').textContent = listMoney(result.netAPayer);
            }
        };
        formControls().forEach(input => input.addEventListener('input', () => {
            clearTimeout(liveTimer);
            liveTimer = setTimeout(() => refreshLiveTotals().catch(() => {}), 350);
        }));
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const button = form.querySelector('.bulletin-components-save');
            const body = new URLSearchParams(new FormData(form));
            button.disabled = true;
            button.textContent = 'Enregistrement…';
            try {
                const saved = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' }, body });
                const savedResult = await saved.json();
                if (!saved.ok || !savedResult.ok) throw new Error(savedResult.error || 'Impossible d’enregistrer le bulletin.');
                const calculated = await fetch(`/bulletins/${form.action.split('/bulletins/')[1].split('/')[0]}/calculate?${body}`, { headers: { Accept: 'application/json' } });
                const result = await calculated.json();
                if (!calculated.ok || !result.ok) throw new Error(result.error || 'Impossible de recalculer le bulletin.');
                const row = form.closest('tr.bulletin-row') || form.closest('details')?.closest('tr');
                const parentRow = form.closest('tr')?.previousElementSibling || row;
                const target = parentRow?.classList.contains('bulletin-row') ? parentRow : document.querySelector(`[data-href^="/bulletins/${form.action.split('/bulletins/')[1].split('/')[0]}"]`);
                target?.querySelector('[data-payroll-sbi]')?.replaceChildren(document.createTextNode(`${listMoney(result.sbi)}`));
                target?.querySelector('[data-payroll-net]')?.replaceChildren(document.createElement('strong'));
                const netNode = target?.querySelector('[data-payroll-net] strong');
                if (netNode) netNode.textContent = listMoney(result.netAPayer);
                button.textContent = 'Enregistré';
                setTimeout(() => { button.textContent = 'Enregistrer les modifications'; }, 1500);
            } catch (error) {
                button.textContent = error.message || 'Erreur';
            } finally {
                button.disabled = false;
            }
        });
    });
})();
