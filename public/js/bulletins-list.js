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
    const money = value => `${Number(value || 0).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
    const findSbiCell = row => {
        const sbiColumn = [...document.querySelectorAll('#bulletins-table thead th')]
            .findIndex(header => header.textContent.trim() === 'Salaire brut imposable');
        return sbiColumn >= 0 ? row.cells[sbiColumn] : null;
    };
    const rowParams = row => {
        const params = new URLSearchParams({
            month: document.querySelector('#sel-month')?.value || '',
            year: document.querySelector('#inp-year')?.value || '',
        });
        row.querySelectorAll('input[name]').forEach(input => {
            if (input.name === 'month' || input.name === 'year') return;
            params.append(input.name, input.value);
        });
        return params;
    };
    const cellForLabel = (row, label) => {
        const index = [...document.querySelectorAll('#bulletins-table thead th')]
            .findIndex(header => {
                const text = header.textContent.trim();
                return text === label || text.endsWith(`· ${label}`);
            });
        return index >= 0 ? row.cells[index] : null;
    };
    const updatePayrollPreview = (row, payroll) => {
        const values = {
            'Salaire brut imposable': payroll.sbi,
            AMO: payroll.amo,
            CNSS: payroll.cnss,
            CIMR: payroll.cimr,
            SNI: payroll.sni,
            IR: payroll.irNet,
        };
        Object.entries(values).forEach(([label, value]) => {
            const cell = cellForLabel(row, label);
            if (cell) cell.textContent = money(value);
        });
        const seniority = cellForLabel(row, "Prime d'ancienneté");
        if (seniority) seniority.textContent = `${(Number(payroll.ancienneteRate || 0) * 100).toFixed(2)} % · ${money(payroll.primeAnciennete)}`;
        const net = row.querySelector('[data-payroll-net]');
        if (net) net.textContent = money(payroll.netAPayer);
        (payroll.nimpLines || []).forEach(line => {
            row.querySelectorAll('[data-nimp-payable]').forEach(payable => {
                const cell = payable.closest('td');
                const labelInput = cell?.querySelector('[name="nimpLabels"]');
                if (String(labelInput?.value || '').trim().toLowerCase() === String(line.label || '').trim().toLowerCase()) {
                    payable.textContent = money(line.amount);
                }
            });
        });
    };
    const paidLeaveConflictMessage = 'Veuillez vérifier les jours travaillés, congés payés et jours fériés : leur total ne peut pas dépasser le nombre de jours du mois.';
    let paidLeaveConflictAlertOpen = false;
    const showCalculationError = (message, inlineMessage, afterPopup, showPopup = true) => {
        if (message === paidLeaveConflictMessage && showPopup) {
            if (paidLeaveConflictAlertOpen) return;
            paidLeaveConflictAlertOpen = true;
            window.AppDialog.alert(message, { title: 'Alerte', danger: true, confirmLabel: 'Compris' })
                .finally(() => { paidLeaveConflictAlertOpen = false; inlineMessage.textContent = ''; afterPopup?.(); });
            return;
        }
        inlineMessage.textContent = message === paidLeaveConflictMessage ? '' : message;
    };
    let dirtyRows = 0;
    window.addEventListener('beforeunload', event => {
        if (dirtyRows) { event.preventDefault(); event.returnValue = ''; }
    });
    const employeeIdForRow = row => {
        const match = String(row.dataset.href || '').match(/\/bulletins\/(\d+)/);
        return match ? match[1] : '';
    };
    const selectedPeriod = () => ({
        month: document.querySelector('#sel-month')?.value || '',
        year: document.querySelector('#inp-year')?.value || '',
    });
    // Non-taxable indemnities can be adjusted from the overview, even on a
    // locked bulletin. Only lines that already exist for the employee are
    // editable, and the amount is capped by the catalogue ceiling.
    document.querySelectorAll('.bulletin-row .nimp-amount-input').forEach(input => {
        if (input.disabled) return;
        const row = input.closest('.bulletin-row');
        const employeeId = employeeIdForRow(row);
        if (!employeeId) return;
        const originalValue = input.value;
        let committing = false;
        let capAlertOpen = false;
        const showCapAlert = () => {
            if (capAlertOpen) return;
            capAlertOpen = true;
            window.AppDialog.alert('Le montant ne peut pas dépasser le montant plafonné. Pour modifier ce plafond, éditez l’indemnité sur la fiche salarié.', {
                title: 'Montant plafonné', danger: true, confirmLabel: 'Compris',
            }).finally(() => { capAlertOpen = false; });
        };

        input.addEventListener('input', () => {
            const maximum = Number(input.dataset.maxAmount || input.dataset.oldAmount);
            const value = Number(input.value);
            if (Number.isFinite(maximum) && Number.isFinite(value) && value > maximum) {
                showCapAlert();
                input.value = maximum.toFixed(2);
            }
        });
        input.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            input.blur();
        });
        input.addEventListener('change', async () => {
            if (committing) return;
            const maximum = Number(input.dataset.maxAmount || input.dataset.oldAmount);
            let amount = Number(input.value);
            if (!Number.isFinite(amount) || amount <= 0) {
                input.value = originalValue;
                return;
            }
            if (Number.isFinite(maximum) && amount > maximum) amount = maximum;
            input.value = amount.toFixed(2);
            if (amount === Number(originalValue)) return;

            committing = true;
            input.disabled = true;
            try {
                const { month, year } = selectedPeriod();
                const response = await fetch(`/bulletins/${employeeId}/indemnities/update`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({
                        oldLabel: input.dataset.oldLabel,
                        oldAmount: Number(input.dataset.oldAmount),
                        label: input.dataset.oldLabel,
                        amount,
                        saveEmployee: false,
                        month,
                        year,
                    }),
                });
                const result = await response.json();
                if (!response.ok || !result.ok) throw new Error(result.error || "Impossible de modifier l'indemnité.");
                window.location.reload();
            } catch (error) {
                input.disabled = false;
                input.value = originalValue;
                window.AppDialog.alert(error.message || "Impossible de modifier l'indemnité.", {
                    title: 'Modification impossible',
                    danger: true,
                    confirmLabel: 'Compris',
                });
            } finally {
                committing = false;
            }
        });
    });
    document.querySelectorAll('.bulletin-row').forEach(row => {
        const form = row.querySelector('.worked-days-form');
        if (!form) return;
        const input = form.elements.workedDays || form.elements.workedHours;
        const message = form.querySelector('.worked-days-message');
        const sbi = findSbiCell(row);
        const net = row.querySelector('[data-payroll-net]');
        let savedWorkingTime = input.value;
        let savedAmounts = { sbi: sbi?.textContent || '', net: net?.textContent || '' };
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
            if (sbi) sbi.textContent = savedAmounts.sbi;
            if (net) net.textContent = savedAmounts.net;
        }
        async function calculate(save = false) {
            if (!input.checkValidity() || saving) return;
            const version = ++sequence;
            pending?.abort();
            pending = new AbortController();
            const body = rowParams(row);
            if (save) { saving = true; input.readOnly = true; }
            message.textContent = save ? 'Enregistrement…' : 'Calcul…';
            try {
                const response = await fetch(save ? form.action : `/bulletins/${form.action.split('/bulletins/')[1].split('/')[0]}/calculate?${body}`, {
                    method: save ? 'POST' : 'GET',
                    headers: { Accept: 'application/json' },
                    ...(save ? { body } : {}),
                    signal: pending.signal,
                });
                const result = await response.json();
                if (version !== sequence) return;
                if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible de mettre à jour le bulletin.');
                updatePayrollPreview(row, result.payroll || result);
                if (save) {
                    savedWorkingTime = input.value;
                    savedAmounts = { sbi: sbi?.textContent || '', net: net?.textContent || '' };
                    setDirty(false);
                }
                message.textContent = save ? 'Enregistré' : 'Aperçu · non enregistré';
            } catch (error) {
                if (version !== sequence || error.name === 'AbortError') return;
                restoreAmounts();
                showCalculationError(error.message || 'Erreur de connexion. Veuillez réessayer.', message, null, save);
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

        row.querySelectorAll('input[name]:not([name="workedDays"]):not([name="workedHours"]):not([name="month"]):not([name="year"]):not([name="nimpAmounts"])').forEach(field => {
            if (field.type === 'hidden') return;
            let previewTimer;
            field.addEventListener('input', () => {
                clearTimeout(previewTimer);
                previewTimer = setTimeout(async () => {
                    try {
                        const response = await fetch(`/bulletins/${form.action.split('/bulletins/')[1].split('/')[0]}/calculate?${rowParams(row)}`, { headers: { Accept: 'application/json' } });
                        const result = await response.json();
                        if (!response.ok || !result.ok) throw new Error(result.error || 'Calcul impossible.');
                        updatePayrollPreview(row, result);
                        message.textContent = 'Aperçu · non enregistré';
                    } catch (error) {
                        showCalculationError(error.message || 'Erreur de calcul.', message, null, false);
                    }
                }, 300);
            });
            field.addEventListener('keydown', async event => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                try {
                    message.textContent = 'Enregistrement…';
                    const employeeId = form.action.split('/bulletins/')[1].split('/')[0];
                    const response = await fetch(`/bulletins/${employeeId}/generate`, {
                        method: 'POST',
                        headers: { Accept: 'application/json' },
                        body: rowParams(row),
                    });
                    const result = await response.json();
                    if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible d’enregistrer les modifications.');
                    message.textContent = 'Enregistré';
                } catch (error) {
                    window.AppDialog.alert(error.message || 'Erreur d’enregistrement.', {
                        title: 'Modification impossible', danger: true, confirmLabel: 'Compris',
                    });
                    message.textContent = error.message || 'Erreur d’enregistrement.';
                }
            });
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
                button.textContent = 'Enregistrer';
                window.AppDialog.alert(error.message || 'Erreur', {
                    title: 'Modification impossible',
                    danger: true,
                    confirmLabel: 'Compris',
                });
            } finally {
                button.disabled = false;
            }
        });
    });
})();
