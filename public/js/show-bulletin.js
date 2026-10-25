(() => {
    const page = document.querySelector('.payroll-print');
    const form = document.querySelector('#payroll-form');
    const lines = document.querySelector('#prime-lines');
    if (!page || !form) return;

    const locked = page.dataset.locked === 'true';
    const money = value => `${Number(value || 0).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD`;
    const days = value => Number(value || 0).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const paidLeaveConflictMessage = 'Veuillez vérifier le nombre de jours travaillés : les jours travaillés et les jours de congé payé ne peuvent pas dépasser le nombre de jours du mois.';
    let paidLeaveConflictAlertOpen = false;
    const showPaidLeaveConflictAlert = () => {
        if (paidLeaveConflictAlertOpen) return;
        paidLeaveConflictAlertOpen = true;
        window.AppDialog.alert(paidLeaveConflictMessage, {
            title: 'Alerte',
            danger: true,
            confirmLabel: 'Compris',
        }).finally(() => { paidLeaveConflictAlertOpen = false; });
    };
    const timeValue = value => Number(value || 0).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const setResult = (name, value) => document.querySelectorAll(`[data-result="${name}"]`).forEach(node => {
        node.textContent = money(value);
    });
    const setAnnualCumulative = cumulative => {
        if (!cumulative) return;
        document.querySelectorAll('[data-result="annualWorkedDays"]').forEach(node => { node.textContent = days(cumulative.workedDays); });
        document.querySelectorAll('[data-result="annualWorkedHours"]').forEach(node => { node.textContent = timeValue(cumulative.workedHours); });
        ['sbi', 'brutGlobal', 'sni', 'irNet', 'cnss', 'amo'].forEach(key => {
            document.querySelectorAll(`[data-result="annual${key[0].toUpperCase()}${key.slice(1)}"]`).forEach(node => {
                node.textContent = money(cumulative[key]);
            });
        });
    };
    const params = () => {
        const values = new URLSearchParams(new FormData(form));
        values.set('month', page.dataset.month);
        values.set('year', page.dataset.year);
        values.delete('normalHours');
        return values;
    };

    const primeDialog = document.querySelector('#prime-dialog');
    const primeDialogForm = document.querySelector('#prime-dialog-form');
    const primeLabelInput = document.querySelector('#prime-label-input');
    const primeAmountInput = document.querySelector('#prime-amount-input');
    const primeCodeInput = document.querySelector('#prime-code-input');
    const paidLeaveStoredInput = document.querySelector('#paid-leave-days-value');
    const publicHolidayStoredInput = document.querySelector('#jours-feries-value');
    const initialPaidLeaveRow = document.querySelector('.paid-leave-row');
    const syncPaidLeaveRow = () => {
        const rowInput = document.querySelector('.paid-leave-row-input');
        if (rowInput && paidLeaveStoredInput) paidLeaveStoredInput.value = rowInput.value || '0';
    };
    initialPaidLeaveRow?.querySelector('.paid-leave-row-input')?.addEventListener('input', syncPaidLeaveRow);
    async function savePaidLeaveDays() {
        if (!paidLeaveStoredInput || locked) return;
        if (typeof hasPaidLeaveConflict === 'function' && hasPaidLeaveConflict()) {
            showPaidLeaveConflictAlert();
            return;
        }
        const body = new URLSearchParams({ month: page.dataset.month, year: page.dataset.year, paidLeaveDays: paidLeaveStoredInput.value || '0' });
        const response = await fetch(`/bulletins/${page.dataset.employeeId}/paid-leave`, { method: 'POST', headers: { Accept: 'application/json' }, body });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible d’enregistrer le congé payé.');
        renderPayroll(result.payroll);
    }
    initialPaidLeaveRow?.querySelector('.paid-leave-row-input')?.addEventListener('change', () => {
        savePaidLeaveDays().catch(errorObject => {
            if (errorObject.message === paidLeaveConflictMessage) showPaidLeaveConflictAlert();
            else window.AppDialog.alert(errorObject.message);
            calculate();
        });
    });
    initialPaidLeaveRow?.querySelector('.paid-leave-row-input')?.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        syncPaidLeaveRow();
        savePaidLeaveDays().catch(errorObject => {
            if (errorObject.message === paidLeaveConflictMessage) showPaidLeaveConflictAlert();
            else window.AppDialog.alert(errorObject.message);
            calculate();
        });
    });
    const publicHolidayRow = document.querySelector('.public-holiday-row');
    const syncPublicHolidayRow = () => {
        const rowInput = publicHolidayRow?.querySelector('.public-holiday-row-input');
        if (rowInput && publicHolidayStoredInput) publicHolidayStoredInput.value = rowInput.value || '0';
    };
    async function savePublicHolidayDays() {
        if (!publicHolidayStoredInput || locked) return;
        const body = new URLSearchParams({ month: page.dataset.month, year: page.dataset.year, joursFeries: publicHolidayStoredInput.value || '0' });
        const response = await fetch(`/bulletins/${page.dataset.employeeId}/public-holiday`, { method: 'POST', headers: { Accept: 'application/json' }, body });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible d’enregistrer les jours fériés.');
        if (Number(result.payroll?.joursFeries || 0) <= 0) {
            window.location.reload();
            return;
        }
        renderPayroll(result.payroll);
    }
    publicHolidayRow?.querySelector('.public-holiday-row-input')?.addEventListener('input', syncPublicHolidayRow);
    publicHolidayRow?.querySelector('.public-holiday-row-input')?.addEventListener('change', () => {
        savePublicHolidayDays().catch(errorObject => { window.AppDialog.alert(errorObject.message); calculate(); });
    });
    publicHolidayRow?.querySelector('.public-holiday-row-input')?.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        syncPublicHolidayRow();
        savePublicHolidayDays().catch(errorObject => { window.AppDialog.alert(errorObject.message); calculate(); });
    });
    const primeRubriqueSelect = document.querySelector('#prime-rubrique-select');
    primeRubriqueSelect?.addEventListener('change', () => {
        const option = primeRubriqueSelect.selectedOptions[0];
        if (!option?.value) return;
        primeCodeInput.value = option.dataset.code || '';
        primeLabelInput.value = option.dataset.name || '';
    });
    const confirmDeletion = message => window.AppDialog.confirm(message, {
        title: 'Confirmer la suppression', confirmLabel: 'Supprimer', danger: true,
    });

    document.querySelector('#add-prime')?.addEventListener('click', () => {
        primeDialog?.showModal();
        primeLabelInput?.focus();
    });
    document.querySelector('#prime-dialog-cancel')?.addEventListener('click', () => primeDialog?.close());
    primeDialogForm?.addEventListener('submit', async event => {
        if (event.submitter?.value !== 'add') return;
        event.preventDefault();
        const label = primeLabelInput.value.trim();
        const code = primeCodeInput.value.trim();
        const amount = Number(primeAmountInput.value);
        const submitButton = event.submitter;
        submitButton.disabled = true;
        submitButton.textContent = 'Enregistrement...';
        try {
            const response = await fetch(`/bulletins/${page.dataset.employeeId}/primes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ code, label, amount, rubriqueImposableId: primeRubriqueSelect?.value || null, month: page.dataset.month, year: page.dataset.year })
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible d’enregistrer la prime.');

            const row = document.createElement('tr');
            row.className = 'prime-row taxable-prime-line';
            const escapedLabel = label.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const escapedValue = label.replace(/"/g, '&quot;');
            const savedAmount = Number(result.bonus.amount).toFixed(2);
            row.innerHTML = `<td class="rubrique-code">${result.bonus.code || ''}</td><td class="description"><input name="primesLabels" value="${escapedValue}" placeholder="Nom de la prime"></td><td class="num">—</td><td class="num">—</td><td class="num"><input class="live-input" name="primesAmounts" type="number" min="0" step="0.01" value="${savedAmount}" placeholder="Montant DH"></td><td class="num">—</td><td class="num"><button type="button" class="remove-prime" aria-label="Supprimer">×</button></td>`;
            const primeRows = [...lines.querySelectorAll('.taxable-prime-line:not(.calculated-taxable-line)')];
            const lastPrime = primeRows[primeRows.length - 1];
            const seniorityRow = lines.querySelector('.seniority-row');
            const insertionPoint = lastPrime || seniorityRow;
            insertionPoint ? insertionPoint.after(row) : lines.prepend(row);
            primeDialogForm.reset();
            primeDialog?.close();
            window.location.reload();
            calculate();
        } catch (errorObject) {
            window.AppDialog.alert(errorObject.message);
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Ajouter la prime';
        }
    });


    const otherRubriqueDialog = document.querySelector('#other-rubrique-dialog');
    const otherRubriqueDialogForm = document.querySelector('#other-rubrique-dialog-form');
    const otherRubriqueSelect = document.querySelector('#other-rubrique-select');
    const otherRubriqueAmountInput = document.querySelector('#other-rubrique-amount-input');
    const otherRubriqueValueLabel = document.querySelector('#other-rubrique-value-label');
    otherRubriqueSelect?.addEventListener('change', () => {
        const option = otherRubriqueSelect.selectedOptions[0];
        const isPaidLeave = option?.dataset.type === 'paid_leave';
        const isPublicHoliday = option?.dataset.type === 'public_holiday';
        const isDayCount = isPaidLeave || isPublicHoliday;
        if (otherRubriqueValueLabel) otherRubriqueValueLabel.textContent = isDayCount ? 'Nombre de jours' : 'Montant en DH';
        if (otherRubriqueAmountInput) {
            otherRubriqueAmountInput.value = '';
            otherRubriqueAmountInput.max = isDayCount ? '26' : '';
            otherRubriqueAmountInput.step = isDayCount ? '1' : '0.01';
            otherRubriqueAmountInput.placeholder = isDayCount ? 'Ex. 2' : 'Optionnel';
        }
    });
    document.querySelector('#add-other-rubrique')?.addEventListener('click', () => {
        otherRubriqueDialog?.showModal();
        otherRubriqueSelect?.focus();
    });
    document.querySelector('#other-rubrique-dialog-cancel')?.addEventListener('click', () => otherRubriqueDialog?.close());
    otherRubriqueDialogForm?.addEventListener('submit', async event => {
        if (event.submitter?.value !== 'add') return;
        event.preventDefault();
        const option = otherRubriqueSelect?.selectedOptions[0];
        const rubriqueImposableId = otherRubriqueSelect?.value;
        const isPaidLeave = option?.dataset.type === 'paid_leave';
        const isPublicHoliday = option?.dataset.type === 'public_holiday';
        const amount = Number(otherRubriqueAmountInput?.value || 0);
        if (!rubriqueImposableId || !Number.isFinite(amount) || amount < 0 || ((isPaidLeave || isPublicHoliday) && (!Number.isInteger(amount) || amount <= 0 || amount > 26))) {
            window.AppDialog.alert(isPaidLeave || isPublicHoliday
                ? `Choisissez la rubrique ${isPaidLeave ? 'congé' : 'jours fériés'} et saisissez un nombre de jours entre 1 et 26.`
                : 'Choisissez une rubrique et saisissez un montant valide.');
            return;
        }
        const submitButton = event.submitter;
        submitButton.disabled = true;
        submitButton.textContent = 'Enregistrement...';
        try {
            const response = isPaidLeave
                ? await fetch(`/bulletins/${page.dataset.employeeId}/paid-leave`, {
                    method: 'POST',
                    headers: { Accept: 'application/json' },
                    body: new URLSearchParams({
                        month: page.dataset.month,
                        year: page.dataset.year,
                        paidLeaveDays: String(amount),
                    }),
                })
                : isPublicHoliday
                ? await fetch(`/bulletins/${page.dataset.employeeId}/public-holiday`, {
                    method: 'POST',
                    headers: { Accept: 'application/json' },
                    body: new URLSearchParams({
                        month: page.dataset.month,
                        year: page.dataset.year,
                        joursFeries: String(amount),
                    }),
                })
                : await fetch(`/bulletins/${page.dataset.employeeId}/primes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({
                        rubriqueImposableId,
                        code: option?.dataset.code || '',
                        label: option?.dataset.name || '',
                        amount,
                        month: page.dataset.month,
                        year: page.dataset.year,
                    }),
                });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || (isPaidLeave ? 'Impossible d’enregistrer le congé.' : isPublicHoliday ? 'Impossible d’enregistrer les jours fériés.' : 'Impossible d’ajouter la rubrique.'));
            window.location.reload();
        } catch (errorObject) {
            if (errorObject.message === paidLeaveConflictMessage) showPaidLeaveConflictAlert();
            else window.AppDialog.alert(errorObject.message);
            submitButton.disabled = false;
            submitButton.textContent = 'Ajouter';
        }
    });

    const overtimeDialog = document.querySelector('#overtime-dialog');
    const overtimeDialogForm = document.querySelector('#overtime-dialog-form');
    const overtimeTypeSelect = document.querySelector('#overtime-type-select');
    const overtimeHoursInput = document.querySelector('#overtime-hours-input');
    document.querySelector('#add-overtime')?.addEventListener('click', () => {
        overtimeHoursInput.value = '';
        overtimeDialog?.showModal();
        overtimeHoursInput?.focus();
    });
    document.querySelector('#overtime-dialog-cancel')?.addEventListener('click', () => overtimeDialog?.close());
    overtimeDialogForm?.addEventListener('submit', event => {
        if (event.submitter?.value !== 'add') return;
        event.preventDefault();
        const hours = Number(overtimeHoursInput?.value);
        const selectedOvertimeField = overtimeTypeSelect?.value;
        if (!selectedOvertimeField || !Number.isFinite(hours) || hours <= 0) {
            window.AppDialog.alert('Saisissez un nombre d’heures positif.');
            return;
        }
        let hiddenInput = form.querySelector(`input[type="hidden"][name="${selectedOvertimeField}"]`);
        if (!hiddenInput) {
            hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.name = selectedOvertimeField;
            form.appendChild(hiddenInput);
        }
        hiddenInput.value = String(hours);
        overtimeDialog?.close();
        form.requestSubmit();
    });

    const indemnityDialog = document.querySelector('#indemnity-dialog');
    const indemnityDialogForm = document.querySelector('#indemnity-dialog-form');
    const indemnityLabelInput = document.querySelector('#indemnity-label-input');
    const indemnityAmountInput = document.querySelector('#indemnity-amount-input');
    const indemnityCodeInput = document.querySelector('#indemnity-code-input');
    document.querySelector('#add-indemnity')?.addEventListener('click', () => {
        indemnityDialog?.showModal();
        indemnityLabelInput?.focus();
    });
    document.querySelector('#indemnity-dialog-cancel')?.addEventListener('click', () => indemnityDialog?.close());
    document.querySelectorAll('.restore-indemnity').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            const response = await fetch(`/bulletins/${page.dataset.employeeId}/indemnities/restore`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ label: button.dataset.label, month: page.dataset.month, year: page.dataset.year }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || "Impossible de restaurer l'indemnité.");
            window.location.reload();
        } catch (errorObject) {
            button.disabled = false;
            window.AppDialog.alert(errorObject.message);
        }
    }));
    indemnityDialogForm?.addEventListener('submit', async event => {
        if (event.submitter?.value !== 'add') return;
        event.preventDefault();
        const label = indemnityLabelInput.value.trim();
        const code = indemnityCodeInput.value.trim();
        const amount = Number(indemnityAmountInput.value);
        const submitButton = event.submitter;
        submitButton.disabled = true;
        submitButton.textContent = 'Enregistrement...';
        try {
            const response = await fetch(`/bulletins/${page.dataset.employeeId}/indemnities`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ code, label, amount, month: page.dataset.month, year: page.dataset.year })
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || "Impossible d'enregistrer l'indemnité.");
            indemnityDialogForm.reset();
            indemnityDialog?.close();
            const keepForEmployee = await window.AppDialog.confirm(
                "L’ajouter aux prochains bulletins de cet employé ?",
                { title: "Conserver l’indemnité", confirmLabel: "Oui, conserver", cancelLabel: "Non, seulement ce bulletin" }
            );
            if (keepForEmployee) {
                const stickResponse = await fetch(`/bulletins/${page.dataset.employeeId}/indemnities/stick`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ label, amount, month: page.dataset.month, year: page.dataset.year })
                });
                const stickResult = await stickResponse.json();
                if (!stickResponse.ok || !stickResult.ok) throw new Error(stickResult.error || "Impossible de conserver l'indemnité.");

                // Re-run the current-bulletin endpoint after the employee bonus
                // is stored, so this bulletin also contains the recurring line.
                const currentResponse = await fetch(`/bulletins/${page.dataset.employeeId}/indemnities`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ label, amount, month: page.dataset.month, year: page.dataset.year })
                });
                const currentResult = await currentResponse.json();
                if (!currentResponse.ok || !currentResult.ok) throw new Error(currentResult.error || "Impossible de mettre à jour le bulletin courant.");
            }
            window.location.reload();
        } catch (errorObject) {
            window.AppDialog.alert(errorObject.message);
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = "Ajouter l'indemnité";
        }
    });

    lines?.addEventListener('change', async event => {
        if (!event.target.matches('[name="nimpLabels"], [name="nimpAmounts"]')) return;
        const row = event.target.closest('.monthly-indemnity-line, .fixed-indemnity-line');
        if (!row) return;

        const labelInput = row.querySelector('[name="nimpLabels"]');
        const amountInput = row.querySelector('[name="nimpAmounts"]');
        const oldLabel = labelInput?.dataset.originalLabel;
        const oldAmount = labelInput?.dataset.originalAmount;
        const label = labelInput?.value.trim();
        const amount = Number(amountInput?.value);
        if (!oldLabel || !oldAmount || !label || !Number.isFinite(amount) || amount <= 0) {
            window.AppDialog.alert("L'indemnité à modifier est invalide.");
            window.location.reload();
            return;
        }

        labelInput.disabled = true;
        amountInput.disabled = true;
        try {
            const response = await fetch(`/bulletins/${page.dataset.employeeId}/indemnities/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    oldLabel,
                    oldAmount,
                    label,
                    amount,
                    saveEmployee: false,
                    month: page.dataset.month,
                    year: page.dataset.year,
                }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || "Impossible de modifier l'indemnité.");

            if (row.dataset.sticky === 'true') {
                const saveEmployee = await window.AppDialog.confirm(
                    "Enregistrer aussi cette modification pour les prochains bulletins de cet employé ?",
                    { title: "Modifier l’indemnité récurrente", confirmLabel: "Oui, enregistrer" }
                );
                if (saveEmployee) {
                    const employeeResponse = await fetch(`/bulletins/${page.dataset.employeeId}/indemnities/update`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                        body: JSON.stringify({
                            oldLabel,
                            oldAmount,
                            label,
                            amount,
                            saveEmployee: true,
                            month: page.dataset.month,
                            year: page.dataset.year,
                        }),
                    });
                    const employeeResult = await employeeResponse.json();
                    if (!employeeResponse.ok || !employeeResult.ok) throw new Error(employeeResult.error || "Impossible d'enregistrer la modification pour l'employé.");
                }
            }
            window.location.reload();
        } catch (errorObject) {
            window.AppDialog.alert(errorObject.message);
            window.location.reload();
        }
    });

    lines?.addEventListener('click', async event => {
        if (!event.target.classList.contains('remove-prime')) return;

        const row = event.target.closest('.taxable-prime-line, .monthly-indemnity-line');
        if (row?.classList.contains('monthly-indemnity-line')) {
            const labelInput = row.querySelector('[name="nimpLabels"]');
            const amountInput = row.querySelector('[name="nimpAmounts"]');
            const label = labelInput?.value || 'cette indemnité';
            let removeEmployee = false;
            if (!(await window.AppDialog.confirm(`Voulez-vous supprimer « ${label} » ?`, {
                title: 'Confirmer la suppression',
                confirmLabel: 'Oui, supprimer',
                cancelLabel: 'Annuler',
                danger: true,
            }))) return;
            if (row.dataset.sticky === 'true') {
                const choice = await window.AppDialog.choice(
                    'La supprimer aussi de l’employé ?',
                    { title: 'Suppression définitive', confirmLabel: 'Oui, de la fiche employé', cancelLabel: 'Non, bulletin seulement', abortLabel: 'Annuler', danger: true }
                );
                if (choice === null) return;
                removeEmployee = choice;
            }
            const removeButton = event.target;
            removeButton.disabled = true;
            try {
                const response = await fetch(`/bulletins/${page.dataset.employeeId}/indemnities/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({
                        label: labelInput?.value,
                        amount: amountInput?.value,
                        removeEmployee,
                        month: page.dataset.month,
                        year: page.dataset.year,
                    }),
                });
                const result = await response.json();
                if (!response.ok || !result.ok) throw new Error(result.error || "Impossible de supprimer l'indemnité.");
                window.location.reload();
            } catch (errorObject) {
                removeButton.disabled = false;
                window.AppDialog.alert(errorObject.message);
            }
            return;
        }

        if (row?.classList.contains('taxable-prime-line')) {
            const labelInput = row.querySelector('[name="primesLabels"]');
            const amountInput = row.querySelector('[name="primesAmounts"]');
            const label = labelInput?.value || 'cette prime';
            if (!(await confirmDeletion(`Voulez-vous vraiment supprimer la prime imposable « ${label} » ?`))) return;
            const removeButton = event.target;
            removeButton.disabled = true;
            try {
                const response = await fetch(`/bulletins/${page.dataset.employeeId}/primes/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({
                        label: labelInput?.value,
                        amount: amountInput?.value,
                        month: page.dataset.month,
                        year: page.dataset.year,
                    }),
                });
                const result = await response.json();
                if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible de supprimer la prime.');
                window.location.reload();
            } catch (errorObject) {
                removeButton.disabled = false;
                window.AppDialog.alert(errorObject.message);
            }
            return;
        }

        row?.remove();
        calculate();
    });

    function renderPayroll(result) {
        ['baseSalary', 'baseConge', 'paidLeaveAmount', 'baseFerie', 'joursFeriesAmount', 'sbg', 'sbi', 'sni', 'cnss', 'amo', 'irNet', 'fraisPro', 'netAPayer', 'primeAnciennete', 'cnssPatronale', 'amoPatronale'].forEach(key => setResult(key, result[key]));
        document.querySelectorAll('[data-result="paidLeaveDays"]').forEach(node => { node.textContent = days(result.paidLeaveDays); });
        document.querySelectorAll('.public-holiday-row-input').forEach(node => { node.value = result.joursFeries ?? 0; });
        if (publicHolidayStoredInput) publicHolidayStoredInput.value = result.joursFeries ?? 0;
        document.querySelectorAll('[data-result="irTaux"]').forEach(node => {
            node.textContent = result.irTaux === undefined || result.irTaux === null
                ? '—'
                : `${Number(result.irTaux * 100).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
        });
        document.querySelectorAll('[data-result="arrondiGains"]').forEach(node => { node.textContent = Number(result.arrondi || 0) > 0 ? money(result.arrondi) : '—'; });
        document.querySelectorAll('[data-result="arrondiRetenues"]').forEach(node => { node.textContent = Number(result.arrondi || 0) < 0 ? money(Math.abs(result.arrondi)) : '—'; });
        document.querySelectorAll('[data-result="fraisProRate"]').forEach(node => {
            node.textContent = `${Number(Number(result.fraisProRate || 0) * 100).toLocaleString('fr-MA', { maximumFractionDigits: 2 })}%`;
        });
        setAnnualCumulative(result.annualCumulative);
        const nimpLines = result.nimpLines || [];
        document.querySelectorAll('.monthly-indemnity-line').forEach(row => {
            const label = row.querySelector('[name="nimpLabels"]')?.value?.trim().toLowerCase();
            const line = nimpLines.find(item => String(item.label || '').trim().toLowerCase() === label);
            const payable = row.querySelector('[data-nimp-payable]');
            if (payable) payable.textContent = money(line?.amount || 0);
        });
        document.querySelectorAll('[data-result="workedDays"]').forEach(node => { node.textContent = timeValue(result.workedDays); });
        document.querySelectorAll('[data-result="workedHours"]').forEach(node => { node.textContent = timeValue(result.workedHours); });
        document.querySelectorAll('[data-result="periode"]').forEach(element => {
            element.textContent = result.periode;
        });
        const deductions = Number(result.cnss || 0) + Number(result.amo || 0) + Number(result.cimr || 0) + Number(result.irNet || 0) + Number(result.avanceDeduction || 0) + Number(result.manualRetenusTotal || 0) + Math.max(0, -Number(result.arrondi || 0));
        document.querySelectorAll('[data-result="deductionsTotal"]').forEach(node => { node.textContent = money(deductions); });
        document.querySelectorAll('[data-result="totalGains"]').forEach(node => { node.textContent = money(Number(result.sbg || 0) + Math.max(0, Number(result.arrondi || 0))); });
        setResult('cnssBase', Math.min(Number(result.sbi || 0), 6000));
    }

    let timer;
    let calculationVersion = 0;
    async function calculate() {
        if (locked) return;
        const version = ++calculationVersion;
        const state = document.querySelector('#calculation-state');
        const error = document.querySelector('#calculation-error');
        state.textContent = 'Calcul en cours...';
        error.hidden = true;
        try {
            const response = await fetch(`/bulletins/${page.dataset.employeeId}/calculate?${params()}`, { headers: { Accept: 'application/json' } });
            const result = await response.json();
            if (version !== calculationVersion) return;
            if (!response.ok || !result.ok) throw new Error();
            renderPayroll(result);
            state.textContent = 'Calcul actualisé';
        } catch (errorObject) {
            if (version !== calculationVersion) return;
            state.textContent = 'Calcul à vérifier';
            error.textContent = 'Impossible de calculer le bulletin pour le moment.';
            error.hidden = false;
        }
    }

    const avanceInput = document.querySelector('.avance-deduction-input');
    let savedAvanceDeduction = avanceInput?.dataset.savedValue || '0.00';
    let savingAvanceDeduction = false;
    let avanceSaveTimer;
    async function saveAvanceDeduction() {
        if (!avanceInput || locked || page.dataset.saved !== 'true' || savingAvanceDeduction) return;
        const currentValue = Number(avanceInput.value || 0).toFixed(2);
        if (currentValue === Number(savedAvanceDeduction || 0).toFixed(2)) return;
        if (!avanceInput.checkValidity()) return;
        clearTimeout(avanceSaveTimer);
        savingAvanceDeduction = true;
        avanceInput.readOnly = true;
        try {
            const body = new URLSearchParams({ month: page.dataset.month, year: page.dataset.year, amount: currentValue });
            const response = await fetch(`/bulletins/${page.dataset.employeeId}/avances`, {
                method: 'POST', headers: { Accept: 'application/json' }, body,
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || "Impossible d'enregistrer l'avance.");
            savedAvanceDeduction = currentValue;
            await calculate();
        } catch (errorObject) {
            window.AppDialog.alert(errorObject.message);
            avanceInput.value = Number(savedAvanceDeduction || 0).toFixed(2);
            calculate();
        } finally {
            savingAvanceDeduction = false;
            avanceInput.readOnly = false;
        }
    }
    avanceInput?.addEventListener('input', () => {
        clearTimeout(avanceSaveTimer);
        avanceSaveTimer = setTimeout(saveAvanceDeduction, 450);
    });
    avanceInput?.addEventListener('blur', () => {
        clearTimeout(avanceSaveTimer);
        saveAvanceDeduction();
    });
    avanceInput?.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        saveAvanceDeduction();
    });

    const workingTimeInput = form.elements.workedDays || form.elements.workedHours;
    const hasPaidLeaveConflict = () => {
        if (!workingTimeInput || workingTimeInput.name !== 'workedDays') return false;
        const workedDays = Number(workingTimeInput.value);
        const paidLeaveDays = Number(paidLeaveStoredInput?.value || 0);
        const monthlyDays = Number(workingTimeInput.max || 26);
        return Number.isFinite(workedDays) && Number.isFinite(paidLeaveDays) && workedDays + paidLeaveDays > monthlyDays;
    };
    form.addEventListener('submit', event => {
        if (!hasPaidLeaveConflict()) return;
        event.preventDefault();
        showPaidLeaveConflictAlert();
    });
    let savedWorkingTime = workingTimeInput?.value;
    let savingWorkingTime = false;
    let workingTimeTimer;
    async function calculateWorkingTime(save = false) {
        if (!workingTimeInput || workingTimeInput.disabled || savingWorkingTime || !workingTimeInput.checkValidity()) return;
        if (save && hasPaidLeaveConflict()) {
            showPaidLeaveConflictAlert();
            return;
        }
        const version = ++calculationVersion;
        const state = document.querySelector('#calculation-state');
        const error = document.querySelector('#calculation-error');
        const body = new URLSearchParams({ month: page.dataset.month, year: page.dataset.year, [workingTimeInput.name]: workingTimeInput.value });
        if (save) { savingWorkingTime = true; workingTimeInput.readOnly = true; }
        state.textContent = save ? 'Enregistrement…' : 'Calcul en cours…';
        error.hidden = true;
        try {
            const url = `/bulletins/${page.dataset.employeeId}/worked-days`;
            const response = await fetch(save ? url : `${url}?${body}`, {
                method: save ? 'POST' : 'GET', headers: { Accept: 'application/json' },
                ...(save ? { body } : {}),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible de mettre à jour les jours.');
            if (save) savedWorkingTime = workingTimeInput.value;
            if (version !== calculationVersion) return;
            renderPayroll(result.payroll);
            state.textContent = save ? 'Temps de travail enregistré' : 'Aperçu · temps non enregistré';
        } catch (failure) {
            if (version !== calculationVersion) return;
            state.textContent = 'Modification non enregistrée';
            error.textContent = failure.message;
            error.hidden = false;
        } finally {
            if (save) { savingWorkingTime = false; workingTimeInput.readOnly = false; }
        }
    }
    function saveWorkingTime() {
        clearTimeout(workingTimeTimer);
        clearTimeout(timer);
        if (page.dataset.saved === 'true' && workingTimeInput.value !== savedWorkingTime) calculateWorkingTime(true);
    }
    workingTimeInput?.addEventListener('blur', saveWorkingTime);
    workingTimeInput?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            if (workingTimeInput.reportValidity()) saveWorkingTime();
        }
    });
    window.addEventListener('beforeunload', event => {
        if (workingTimeInput && !workingTimeInput.disabled && workingTimeInput.value !== savedWorkingTime) {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    form.addEventListener('input', event => {
        if (event.target === workingTimeInput && page.dataset.saved === 'true') {
            clearTimeout(workingTimeTimer);
            clearTimeout(timer);
            ++calculationVersion;
            if (workingTimeInput.checkValidity()) workingTimeTimer = setTimeout(() => calculateWorkingTime(), 350);
            else document.querySelector('#calculation-state').textContent = 'Saisissez une valeur de temps de travail valide.';
            return;
        }
        if (event.target.classList.contains('live-input') || event.target.name.includes('primes')) {
            clearTimeout(timer);
            timer = setTimeout(calculate, 350);
        }
    });
    form.addEventListener('change', event => {
        if (event.target === workingTimeInput && page.dataset.saved === 'true') return;
        calculate();
    });
    const employeePanel = document.querySelector('#bulletin-employee-panel');
    const employeeList = document.querySelector('#bulletin-employee-list');
    const employeeSearch = document.querySelector('#bulletin-employee-search');
    const panelToggle = document.querySelector('#bulletin-panel-toggle');
    const noEmployeeResults = document.querySelector('#bulletin-employee-no-results');
    const employeeLinks = [...document.querySelectorAll('.bulletin-employee-link')];
    const panelStorageKey = employeePanel ? `bulletin-panel:${employeePanel.dataset.period}` : null;
    const formSignature = () => JSON.stringify([...new FormData(form).entries()]);
    let savedFormSignature = formSignature();
    let switchingEmployee = false;

    if (employeePanel && panelStorageKey) {
        const panelState = JSON.parse(sessionStorage.getItem(panelStorageKey) || '{}');
        if (panelState.collapsed) {
            employeePanel.classList.add('is-collapsed');
            panelToggle?.setAttribute('aria-expanded', 'false');
            panelToggle?.setAttribute('title', 'Afficher la liste');
        }
        if (employeeList && Number.isFinite(panelState.scrollTop)) employeeList.scrollTop = panelState.scrollTop;
        employeeList?.addEventListener('scroll', () => {
            const state = JSON.parse(sessionStorage.getItem(panelStorageKey) || '{}');
            sessionStorage.setItem(panelStorageKey, JSON.stringify({ ...state, scrollTop: employeeList.scrollTop }));
        });
        panelToggle?.addEventListener('click', () => {
            const collapsed = employeePanel.classList.toggle('is-collapsed');
            panelToggle.setAttribute('aria-expanded', String(!collapsed));
            panelToggle.setAttribute('title', collapsed ? 'Afficher la liste' : 'Réduire la liste');
            const state = JSON.parse(sessionStorage.getItem(panelStorageKey) || '{}');
            sessionStorage.setItem(panelStorageKey, JSON.stringify({ ...state, collapsed }));
        });
        employeeSearch?.addEventListener('input', () => {
            const query = employeeSearch.value.trim().toLowerCase();
            let visible = 0;
            employeeLinks.forEach(link => {
                const matches = !query || link.dataset.search.includes(query);
                link.hidden = !matches;
                if (matches) visible++;
            });
            if (noEmployeeResults) noEmployeeResults.hidden = visible !== 0;
        });
    }

    const saveConfirmation = document.querySelector('#save-confirmation');
    const saveConfirmationStorageKey = 'bulletin-save-confirmation';
    const showSavedConfirmation = () => {
        if (!saveConfirmation) return;
        saveConfirmation.hidden = false;
        clearTimeout(showSavedConfirmation.timer);
        showSavedConfirmation.timer = setTimeout(() => { saveConfirmation.hidden = true; }, 2200);
    };
    if (sessionStorage.getItem(saveConfirmationStorageKey) === 'true') {
        sessionStorage.removeItem(saveConfirmationStorageKey);
        showSavedConfirmation();
    }
    const hasPendingChanges = () => !locked && formSignature() !== savedFormSignature;
    const saveBeforeSwitch = async () => {
        if (!hasPendingChanges()) return true;
        if (switchingEmployee) return false;
        switchingEmployee = true;
        const state = document.querySelector('#calculation-state');
        const error = document.querySelector('#calculation-error');
        state.textContent = 'Enregistrement…';
        error.hidden = true;
        try {
            const response = await fetch(form.action, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                },
                body: new URLSearchParams(new FormData(form)),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible d’enregistrer les modifications.');
            savedFormSignature = formSignature();
            page.dataset.saved = 'true';
            state.textContent = 'Enregistré';
            sessionStorage.setItem(saveConfirmationStorageKey, 'true');
            showSavedConfirmation();
            return true;
        } catch (failure) {
            state.textContent = 'Modification non enregistrée';
            error.textContent = failure.message;
            error.hidden = false;
            return false;
        } finally {
            switchingEmployee = false;
        }
    };
    let catalogueSaveTimer;
    document.querySelectorAll('.catalogue-rubrique-amount').forEach(input => input.addEventListener('input', () => {
        if (locked) return;
        clearTimeout(catalogueSaveTimer);
        catalogueSaveTimer = setTimeout(() => saveBeforeSwitch(), 800);
    }));
    form.addEventListener('keydown', async event => {
        if (event.key !== 'Enter' || event.target.matches('textarea, button, select')) return;
        event.preventDefault();
        if (locked || !hasPendingChanges() || switchingEmployee) return;
        switchingEmployee = true;
        const state = document.querySelector('#calculation-state');
        const error = document.querySelector('#calculation-error');
        state.textContent = 'Enregistrement…';
        error.hidden = true;
        try {
            const response = await fetch(form.action, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                },
                body: new URLSearchParams(new FormData(form)),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible d’enregistrer les modifications.');
            savedFormSignature = formSignature();
            page.dataset.saved = 'true';
            sessionStorage.setItem(saveConfirmationStorageKey, 'true');
            window.location.reload();
        } catch (failure) {
            state.textContent = 'Modification non enregistrée';
            error.textContent = failure.message;
            error.hidden = false;
        } finally {
            switchingEmployee = false;
        }
    });
    employeeLinks.forEach(link => link.addEventListener('click', async event => {
        if (locked || !hasPendingChanges()) return;
        event.preventDefault();
        link.setAttribute('aria-busy', 'true');
        if (await saveBeforeSwitch()) window.location.assign(link.href);
        link.removeAttribute('aria-busy');
    }));
    if (page.dataset.saved !== 'true') calculate();
})();
