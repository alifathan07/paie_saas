(() => {
    const tableWrapper = document.querySelector('#bulletins-table-wrapper');
    const topScrollbar = document.querySelector('#bulletins-scrollbar');
    const bulletinTable = document.querySelector('#bulletins-table');
    const appHeader = document.querySelector('.app-header');
    if (tableWrapper && topScrollbar && bulletinTable) {
        const scrollbarContent = topScrollbar.firstElementChild;
        const stickyHeader = document.createElement('div');
        const stickyHeaderTable = bulletinTable.cloneNode(false);
        const stickyHeaderHead = bulletinTable.tHead.cloneNode(true);
        stickyHeader.classList.add('bulletin-sticky-header');
        stickyHeader.setAttribute('aria-hidden', 'true');
        stickyHeaderTable.removeAttribute('id');
        stickyHeader.style.cssText = 'position:fixed;display:none;overflow:hidden;z-index:30;pointer-events:none;background:#eef2f5;border-bottom:2px solid #8f9eaa;';
        stickyHeaderTable.style.cssText = 'position:relative;display:block;margin:0;border-collapse:separate;border-spacing:0;background:#eef2f5;';
        stickyHeaderHead.style.cssText = 'position:relative;display:block;margin:0;background:#eef2f5;';
        const stickyHeaderRow = stickyHeaderHead.rows[0];
        stickyHeaderRow.style.cssText = 'position:relative;display:block;margin:0;background:#eef2f5;';
        stickyHeaderTable.append(stickyHeaderHead);
        stickyHeader.append(stickyHeaderTable);
        document.body.append(stickyHeader);
        const syncWidth = () => { scrollbarContent.style.width = `${bulletinTable.scrollWidth}px`; };
        const syncNameColumnOffset = () => {
            const matriculeColumn = bulletinTable.querySelector('thead th:first-child');
            if (!matriculeColumn) return;
            bulletinTable.style.setProperty('--sticky-name-offset', `${matriculeColumn.getBoundingClientRect().width}px`);
        };
        const syncStickyHeader = () => {
            const wrapperRect = tableWrapper.getBoundingClientRect();
            const headerRect = bulletinTable.tHead.getBoundingClientRect();
            const top = appHeader?.getBoundingClientRect().bottom || 0;
            const headerHeight = headerRect.height;
            const left = wrapperRect.left + tableWrapper.clientLeft;
            const width = tableWrapper.clientWidth;
            const visible = headerHeight > 0 && headerRect.top < top && wrapperRect.bottom > top + headerHeight;
            stickyHeader.style.display = visible ? 'block' : 'none';
            if (!visible) return;
            stickyHeader.style.left = `${left}px`;
            stickyHeader.style.top = `${top}px`;
            stickyHeader.style.width = `${width}px`;
            stickyHeader.style.height = `${headerHeight}px`;
            stickyHeaderTable.style.width = `${bulletinTable.scrollWidth}px`;
            stickyHeaderTable.style.height = `${headerHeight}px`;
            stickyHeaderHead.style.height = `${headerHeight}px`;
            stickyHeaderRow.style.height = `${headerHeight}px`;
            [...bulletinTable.tHead.rows[0].cells].forEach((sourceCell, index) => {
                const cloneCell = stickyHeaderRow.cells[index];
                const cellRect = sourceCell.getBoundingClientRect();
                cloneCell.style.position = 'absolute';
                cloneCell.style.display = 'block';
                cloneCell.style.boxSizing = 'border-box';
                cloneCell.style.backgroundColor = '#eef2f5';
                cloneCell.style.left = `${cellRect.left - left}px`;
                cloneCell.style.top = `${cellRect.top - headerRect.top}px`;
                cloneCell.style.width = `${cellRect.width}px`;
                cloneCell.style.height = `${cellRect.height}px`;
                cloneCell.style.zIndex = sourceCell.classList.contains('net-column')
                    || sourceCell.classList.contains('employee-name-column')
                    || index === 0 ? '10' : '4';
            });
        };
        let stickyHeaderFrame = 0;
        const scheduleStickyHeaderSync = () => {
            if (stickyHeaderFrame) return;
            stickyHeaderFrame = requestAnimationFrame(() => {
                stickyHeaderFrame = 0;
                syncStickyHeader();
            });
        };
        let syncing = false;
        topScrollbar.addEventListener('scroll', () => {
            if (syncing) return;
            syncing = true;
            tableWrapper.scrollLeft = topScrollbar.scrollLeft;
            syncing = false;
            scheduleStickyHeaderSync();
        });
        tableWrapper.addEventListener('scroll', () => {
            if (syncing) return;
            syncing = true;
            topScrollbar.scrollLeft = tableWrapper.scrollLeft;
            syncing = false;
            scheduleStickyHeaderSync();
        });
        const syncTableLayout = () => {
            syncWidth();
            syncNameColumnOffset();
            scheduleStickyHeaderSync();
        };
        const tableLayoutObserver = new ResizeObserver(syncTableLayout);
        tableLayoutObserver.observe(bulletinTable);
        tableLayoutObserver.observe(tableWrapper);
        const matriculeHeader = bulletinTable.querySelector('thead th:first-child');
        if (matriculeHeader) tableLayoutObserver.observe(matriculeHeader);
        if (appHeader) new ResizeObserver(scheduleStickyHeaderSync).observe(appHeader);
        window.addEventListener('resize', scheduleStickyHeaderSync);
        window.addEventListener('scroll', scheduleStickyHeaderSync, { passive: true });
        syncWidth();
        syncNameColumnOffset();
        syncStickyHeader();
    }
    const currentPeriod = () => {
        const periodForm = document.querySelector('#period-form');
        return {
            month: periodForm?.querySelector('input[name="month"]')?.value || '',
            year: periodForm?.querySelector('input[name="year"]')?.value || '',
        };
    };
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
        const { month, year } = currentPeriod();
        [['month', month], ['year', year], ['scope', submitter.value]]
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
        const { month, year } = currentPeriod();
        const params = new URLSearchParams({ month, year });
        row.querySelectorAll('input[name]').forEach(input => {
            if (input.name === 'month' || input.name === 'year') return;
            params.append(input.name, input.value);
        });
        row.querySelectorAll('.nimp-amount-input').forEach(input => {
            if (input.dataset.calculationRatio) params.append('nimpSourceRatios', input.dataset.calculationRatio);
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
    const updatePayrollPreview = (row, payroll, syncIndemnities = false) => {
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
        const primeRendementAmount = row.querySelector('[data-prime-rendement-amount]');
        if (primeRendementAmount) {
            primeRendementAmount.textContent = Number(payroll.primeRendementAmount || 0)
                .toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        const net = row.querySelector('[data-payroll-net]');
        const netValue = row.querySelector('[data-payroll-net-value]');
        if (netValue) netValue.textContent = money(payroll.netAPayer);
        else if (net) net.textContent = money(payroll.netAPayer);
        (payroll.nimpLines || []).forEach(line => {
            const input = [...row.querySelectorAll('.nimp-amount-input')]
                .find(item => String(item.dataset.oldLabel || '').trim().toLowerCase() === String(line.label || '').trim().toLowerCase());
            if (!input) return;
            if (syncIndemnities) {
                input.value = Number(line.amount || 0).toFixed(2);
                const ratio = payroll.workingTimeMode === 'HOURS'
                    ? Number(payroll.workedHours || 0) / Number(payroll.standardMonthlyHours || 1)
                    : Number(payroll.workedDays || 0) / Number(payroll.standardMonthlyDays || 1);
                input.dataset.calculationRatio = ratio.toFixed(8);
            }
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
    const selectedPeriod = () => currentPeriod();
    // Employees without a bulletin do not have the worked-days form yet, but
    // their overtime inputs are still rendered. Save those values through the
    // same generate endpoint used once the bulletin exists.
    document.querySelectorAll('.bulletin-row').forEach(row => {
        if (row.querySelector('.worked-days-form')) return;
        const employeeId = employeeIdForRow(row);
        row.querySelectorAll('input[name="heuresSup25"], input[name="heuresSup50"], input[name="heuresSup100"], input[name="paidLeaveDays"], input[name="congeNaissanceDays"], input[name="joursFeries"], input[name="primeRendementInput"]').forEach(input => {
            input.addEventListener('change', async () => {
                if (!input.checkValidity()) return;
                try {
                    const response = await fetch(`/bulletins/${employeeId}/generate`, {
                        method: 'POST',
                        headers: { Accept: 'application/json' },
                        body: rowParams(row),
                    });
                    const result = await response.json();
                    if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible d’enregistrer la rubrique.');
                    window.location.reload();
                } catch (error) {
                    window.AppDialog.alert(error.message || 'Erreur d’enregistrement.', {
                        title: 'Modification impossible', danger: true, confirmLabel: 'Compris',
                    });
                }
            });
        });
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
            const maximum = Number(input.dataset.maxAmount);
            const value = Number(input.value);
            if (Number.isFinite(maximum) && maximum > 0 && Number.isFinite(value) && value > maximum) {
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
            const maximum = Number(input.dataset.maxAmount);
            let amount = Number(input.value);
            if (!Number.isFinite(amount) || amount <= 0) {
                input.value = originalValue;
                return;
            }
            if (Number.isFinite(maximum) && maximum > 0 && amount > maximum) amount = maximum;
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
        let savedAmounts = {
            sbi: sbi?.textContent || '',
            net: row.querySelector('[data-payroll-net-value]')?.textContent || net?.textContent || '',
        };
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
            const netValue = row.querySelector('[data-payroll-net-value]');
            if (netValue) netValue.textContent = savedAmounts.net;
            else if (net) net.textContent = savedAmounts.net;
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
                updatePayrollPreview(row, result.payroll || result, true);
                if (save) {
                    savedWorkingTime = input.value;
                    savedAmounts = {
                        sbi: sbi?.textContent || '',
                        net: row.querySelector('[data-payroll-net-value]')?.textContent || net?.textContent || '',
                    };
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
            let savingField = false;
            const isPrimeRendementField = field.name === 'primeRendementInput';
            const saveField = async () => {
                const employeeId = form.action.split('/bulletins/')[1].split('/')[0];
                const body = isPrimeRendementField
                    ? new URLSearchParams({ ...selectedPeriod(), primeRendementInput: field.value })
                    : rowParams(row);
                const endpoint = isPrimeRendementField
                    ? `/bulletins/${employeeId}/prime-rendement`
                    : `/bulletins/${employeeId}/generate`;
                return fetch(endpoint, {
                    method: 'POST',
                    headers: { Accept: 'application/json' },
                    body,
                });
            };
            const isEditablePayrollField = ['heuresSup25', 'heuresSup50', 'heuresSup100', 'paidLeaveDays', 'congeNaissanceDays', 'joursFeries', 'primeRendementInput'].includes(field.name);
            const savePayrollField = async () => {
                if (!isEditablePayrollField || savingField || !field.checkValidity()) return;
                savingField = true;
                clearTimeout(previewTimer);
                message.textContent = 'Enregistrement…';
                try {
                    const response = await saveField();
                    const result = await response.json();
                    if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible d’enregistrer la rubrique.');
                    updatePayrollPreview(row, result.payroll || result);
                    message.textContent = 'Enregistré';
                } catch (error) {
                    window.AppDialog.alert(error.message || 'Erreur d’enregistrement.', {
                        title: 'Modification impossible', danger: true, confirmLabel: 'Compris',
                    });
                    message.textContent = error.message || 'Erreur d’enregistrement.';
                } finally {
                    savingField = false;
                }
            };
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
            field.addEventListener('change', savePayrollField);
            field.addEventListener('keydown', async event => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (isPrimeRendementField) {
                    await savePayrollField();
                    return;
                }
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
    document.querySelectorAll('.bulletin-row').forEach(row => {
        const employeeId = employeeIdForRow(row);
        if (!employeeId) return;
        const hasWorkedDaysForm = Boolean(row.querySelector('.worked-days-form'));
        const inputs = [...row.querySelectorAll('.bulletin-component-input')]
            .filter(input => !hasWorkedDaysForm || input.classList.contains('nimp-amount-input'));
        if (!inputs.length) return;

        const message = row.querySelector('.worked-days-message') || row.querySelector('[data-payroll-status]');
        let liveTimer;
        let sequence = 0;
        let pending;
        const calculate = async () => {
            const version = ++sequence;
            pending?.abort();
            pending = new AbortController();
            if (message) message.textContent = 'Calcul…';
            try {
                const params = rowParams(row);
                const response = await fetch(`/bulletins/${employeeId}/calculate?${params}`, {
                    headers: { Accept: 'application/json' },
                    signal: pending.signal,
                });
                const result = await response.json();
                if (version !== sequence) return;
                if (!response.ok || !result.ok) throw new Error(result.error || 'Calcul impossible.');
                updatePayrollPreview(row, result.payroll || result);
                if (message) message.textContent = 'Aperçu · non enregistré';
            } catch (error) {
                if (version !== sequence || error.name === 'AbortError') return;
                if (message) showCalculationError(error.message || 'Erreur de calcul. Veuillez réessayer.', message, null);
            }
        };

        inputs.forEach(input => input.addEventListener('input', () => {
            clearTimeout(liveTimer);
            ++sequence;
            pending?.abort();
            if (!input.checkValidity()) {
                if (message) message.textContent = 'Saisissez une valeur valide.';
                return;
            }
            if (message) message.textContent = 'Modification non enregistrée…';
            liveTimer = setTimeout(calculate, 300);
        }));
    });
})();
