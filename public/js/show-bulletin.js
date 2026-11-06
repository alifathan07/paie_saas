(() => {
    const page = document.querySelector('.payroll-print');
    const form = document.querySelector('#payroll-form');
    const lines = document.querySelector('#prime-lines');
    if (!page || !form) return;

    const locked = page.dataset.locked === 'true';
    const money = value => `${Number(value || 0).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD`;
    const days = value => Number(value || 0).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const paidLeaveConflictMessage = 'Veuillez vérifier les jours travaillés, congés payés, congés de naissance et jours fériés : leur total ne peut pas dépasser le nombre de jours du mois.';
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
        document.querySelectorAll('.nimp-amount-input').forEach(input => {
            values.append('nimpSourceRatios', input.dataset.calculationRatio || '');
        });
        return values;
    };

    const primeDialog = document.querySelector('#prime-dialog');
    const primeDialogForm = document.querySelector('#prime-dialog-form');
    const primeLabelInput = document.querySelector('#prime-label-input');
    const primeAmountInput = document.querySelector('#prime-amount-input');
    const primeCodeInput = document.querySelector('#prime-code-input');
    const paidLeaveStoredInput = document.querySelector('#paid-leave-days-value');
    const birthLeaveStoredInput = document.querySelector('#birth-leave-days-value');
    const publicHolidayStoredInput = document.querySelector('#jours-feries-value');
    const initialPaidLeaveRow = document.querySelector('.paid-leave-row');
    const syncPaidLeaveRow = () => {
        const rowInput = document.querySelector('.paid-leave-row-input');
        if (rowInput && paidLeaveStoredInput) paidLeaveStoredInput.value = rowInput.value || '0';
    };
    initialPaidLeaveRow?.querySelector('.paid-leave-row-input')?.addEventListener('input', syncPaidLeaveRow);
    const publicHolidayRow = document.querySelector('.public-holiday-row');
    const syncPublicHolidayRow = () => {
        const rowInput = publicHolidayRow?.querySelector('.public-holiday-row-input');
        if (rowInput && publicHolidayStoredInput) publicHolidayStoredInput.value = rowInput.value || '0';
    };
    publicHolidayRow?.querySelector('.public-holiday-row-input')?.addEventListener('input', syncPublicHolidayRow);
    const birthLeaveRow = document.querySelector('.birth-leave-row');
    const syncBirthLeaveRow = () => {
        const rowInput = birthLeaveRow?.querySelector('.birth-leave-row-input');
        if (rowInput && birthLeaveStoredInput) birthLeaveStoredInput.value = rowInput.value || '0';
    };
    birthLeaveRow?.querySelector('.birth-leave-row-input')?.addEventListener('input', syncBirthLeaveRow);
    const primeRubriqueSelect = document.querySelector('#prime-rubrique-select');
    primeRubriqueSelect?.addEventListener('change', () => {
        const option = primeRubriqueSelect.selectedOptions[0];
        if (!option?.value) return;
        primeCodeInput.value = option.dataset.code || '';
        primeLabelInput.value = option.dataset.name || '';
        primeAmountInput.value = option.dataset.amount || '';
    });
    const confirmDeletion = message => window.AppDialog.confirm(message, {
        title: 'Confirmer la suppression', confirmLabel: 'Supprimer', danger: true,
    });

    document.querySelector('#add-prime')?.addEventListener('click', () => {
        primeDialog?.showModal();
        primeLabelInput?.focus();
    });
    document.querySelector('#prime-dialog-cancel')?.addEventListener('click', () => primeDialog?.close());
    document.querySelector('#prime-save-catalogue')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        const code = primeCodeInput.value.trim();
        const label = primeLabelInput.value.trim();
        const amount = Number(primeAmountInput.value);
        if (!code || !label || !Number.isFinite(amount) || amount < 0) {
            window.AppDialog.alert('Saisissez le code, le nom et le montant de la prime.');
            return;
        }
        button.disabled = true;
        try {
            const response = await fetch(`/bulletins/${page.dataset.employeeId}/primes/catalogue`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ code, label, amount }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible d’ajouter la prime au catalogue.');
            window.location.reload();
        } catch (errorObject) {
            button.disabled = false;
            window.AppDialog.alert(errorObject.message);
        }
    });
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
        body: JSON.stringify({ code, label, amount, rubriqueImposableId: null, month: page.dataset.month, year: page.dataset.year })
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
    const indemnityCatalogueSelect = document.querySelector('#indemnity-catalogue-select');
    indemnityCatalogueSelect?.addEventListener('change', () => {
        const option = indemnityCatalogueSelect.selectedOptions[0];
        if (!option?.value) return;
        indemnityCodeInput.value = option.dataset.code || '';
        indemnityLabelInput.value = option.dataset.name || '';
        indemnityAmountInput.value = option.dataset.amount || '';
    });
    document.querySelector('#indemnity-save-catalogue')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        const code = indemnityCodeInput.value.trim();
        const label = indemnityLabelInput.value.trim();
        const amount = Number(indemnityAmountInput.value);
        if (!code || !label || !Number.isFinite(amount) || amount < 0) {
            window.AppDialog.alert('Saisissez le code, le nom et le montant de l’indemnité.');
            return;
        }
        button.disabled = true;
        try {
            const response = await fetch(`/bulletins/${page.dataset.employeeId}/indemnities/catalogue`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ code, label, amount }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible d’ajouter l’indemnité au catalogue.');
            window.location.reload();
        } catch (errorObject) {
            button.disabled = false;
            window.AppDialog.alert(errorObject.message);
        }
    });
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

    document.querySelectorAll('.nimp-amount-input').forEach(input => {
        if (input.disabled) return;
        const row = input.closest('.monthly-indemnity-line, .fixed-indemnity-line');
        const employeeId = page.dataset.employeeId;
        if (!row || !employeeId) return;
        let originalValue = input.value;
        let committing = false;
        let capAlertOpen = false;
        const showCapAlert = () => {
            if (capAlertOpen) return;
            capAlertOpen = true;
            window.AppDialog.alert('Le montant ne peut pas dépasser le montant plafonné. Pour modifier ce plafond, éditez l’indemnité sur la fiche salarié.', {
                title: 'Montant plafonné', danger: true, confirmLabel: 'Compris',
            }).finally(() => { capAlertOpen = false; });
        };

        input.addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            input.dispatchEvent(new Event('change', { bubbles: false }));
        });

        input.addEventListener('change', async () => {
            if (committing || !locked) return;
            clearTimeout(timer);
            ++calculationVersion;
            const oldLabel = input.dataset.originalLabel;
            const oldAmount = Number(input.dataset.originalAmount);
            let amount = Number(input.value);
            if (!oldLabel || !Number.isFinite(oldAmount) || oldAmount <= 0 || !Number.isFinite(amount) || amount <= 0) {
                input.value = originalValue;
                return;
            }
            const maximum = Number(input.dataset.maxAmount);
            if (Number.isFinite(maximum) && maximum > 0 && amount > maximum) {
                showCapAlert();
                amount = maximum;
                input.value = maximum.toFixed(2);
            }
            input.value = amount.toFixed(2);
            if (amount === Number(originalValue)) return;

            committing = true;
            input.disabled = true;
            try {
                const { month, year } = { month: page.dataset.month, year: page.dataset.year };
                const response = await fetch(`/bulletins/${employeeId}/indemnities/update`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({
                        oldLabel,
                        oldAmount,
                        label: oldLabel,
                        amount,
                        saveEmployee: false,
                        month,
                        year,
                    }),
                });
                const result = await response.json();
                if (!response.ok || !result.ok) throw new Error(result.error || "Impossible de modifier l'indemnité.");
                originalValue = Number(result.bonus.amount).toFixed(2);
                input.dataset.originalAmount = originalValue;
                input.value = originalValue;
                input.disabled = false;
                if (await calculate({ preserveIndemnityInputs: true, allowLocked: true })) {
                    document.querySelector('#calculation-state').textContent = 'Indemnité enregistrée';
                }
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

    lines?.addEventListener('keydown', event => {
        if (!event.target.matches('[name="nimpLabels"], [name="nimpAmounts"]') || event.key !== 'Enter') return;
        event.preventDefault();
        event.target.blur();
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

    function renderPayroll(result, { preserveIndemnityInputs = false } = {}) {
        ['baseSalary', 'baseConge', 'paidLeaveAmount', 'baseCongeNaissance', 'congeNaissanceAmount', 'baseFerie', 'joursFeriesAmount', 'sbg', 'sbi', 'sni', 'cnss', 'amo', 'irNet', 'fraisPro', 'netAPayer', 'primeAnciennete', 'primeRendementAmount', 'cnssPatronale', 'amoPatronale'].forEach(key => setResult(key, result[key]));
        document.querySelectorAll('[data-overtime-amount]').forEach(node => {
            const hours = Number(result[node.dataset.overtimeAmount] || 0);
            const base = Number(result.baseSalary || 0);
            const monthlyHours = Number(result.standardMonthlyHours || 191);
            const multiplier = Number(node.dataset.overtimeMultiplier || 1);
            node.textContent = money(hours * base / monthlyHours * multiplier);
        });
        document.querySelectorAll('[data-result="paidLeaveDays"]').forEach(node => { node.textContent = days(result.paidLeaveDays); });
        document.querySelectorAll('.public-holiday-row-input').forEach(node => { node.value = result.joursFeries ?? 0; });
        if (publicHolidayStoredInput) publicHolidayStoredInput.value = result.joursFeries ?? 0;
        document.querySelectorAll('.birth-leave-row-input').forEach(node => { node.value = result.congeNaissanceDays ?? 0; });
        if (birthLeaveStoredInput) birthLeaveStoredInput.value = result.congeNaissanceDays ?? 0;
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
            const amountInput = row.querySelector('[name="nimpAmounts"]');
            if (amountInput && line) {
                const ficheAmount = Number(amountInput.dataset.ficheAmount);
                const ratio = result.workingTimeMode === 'HOURS'
                    ? Number(result.workedHours || 0) / Number(result.standardMonthlyHours || 1)
                    : Number(result.workedDays || 0) / Number(result.standardMonthlyDays || 1);
                const maximum = Number.isFinite(ficheAmount) && ficheAmount > 0
                    ? Number((ficheAmount * ratio).toFixed(2))
                    : Number(amountInput.dataset.maxAmount || 0);
                amountInput.dataset.maxAmount = maximum > 0 ? maximum.toFixed(2) : '';
                if (maximum > 0) amountInput.max = maximum.toFixed(2);
                else amountInput.removeAttribute('max');
                if (!preserveIndemnityInputs) amountInput.value = Number(line.amount || 0).toFixed(2);
                amountInput.dataset.calculationRatio = ratio.toFixed(8);
            }
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
    async function calculate({ preserveIndemnityInputs = false, allowLocked = false } = {}) {
        if (locked && !allowLocked) return false;
        const version = ++calculationVersion;
        const state = document.querySelector('#calculation-state');
        const error = document.querySelector('#calculation-error');
        state.textContent = 'Calcul en cours...';
        error.hidden = true;
        try {
            const response = await fetch(`/bulletins/${page.dataset.employeeId}/calculate?${params()}`, { headers: { Accept: 'application/json' } });
            const result = await response.json();
            if (version !== calculationVersion) return false;
            if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible de calculer le bulletin.');
            renderPayroll(result, { preserveIndemnityInputs });
            state.textContent = 'Aperçu · non enregistré';
            return true;
        } catch (errorObject) {
            if (version !== calculationVersion) return;
            state.textContent = 'Calcul à vérifier';
            error.textContent = errorObject.message || 'Impossible de calculer le bulletin pour le moment.';
            error.hidden = false;
            return false;
        }
    }

    const workingTimeInput = form.elements.workedDays || form.elements.workedHours;
    const hasPaidLeaveConflict = () => {
        if (!workingTimeInput || workingTimeInput.name !== 'workedDays') return false;
        const workedDays = Number(workingTimeInput.value);
        const paidLeaveDays = Number(paidLeaveStoredInput?.value || 0);
        const birthLeaveDays = Number(birthLeaveStoredInput?.value || 0);
        const publicHolidayDays = Number(publicHolidayStoredInput?.value || 0);
        const monthlyDays = Number(workingTimeInput.max || 26);
        return Number.isFinite(workedDays) && Number.isFinite(paidLeaveDays) && Number.isFinite(birthLeaveDays) && Number.isFinite(publicHolidayDays)
            && workedDays + paidLeaveDays + birthLeaveDays + publicHolidayDays > monthlyDays;
    };
    form.addEventListener('submit', async event => {
        if (hasPaidLeaveConflict()) {
            event.preventDefault();
            showPaidLeaveConflictAlert();
            return;
        }
        if (locked || !hasPendingChanges()) return;
        event.preventDefault();
        const submitter = event.submitter;
        if (await saveBeforeSwitch()) {
            if (submitter) form.requestSubmit(submitter);
        }
    });
    let workingTimeTimer;
    async function calculateWorkingTime() {
        if (!workingTimeInput || workingTimeInput.disabled || !workingTimeInput.checkValidity()) return;
        const version = ++calculationVersion;
        const state = document.querySelector('#calculation-state');
        const error = document.querySelector('#calculation-error');
        const body = params();
        state.textContent = 'Calcul en cours…';
        error.hidden = true;
        try {
            const response = await fetch(`/bulletins/${page.dataset.employeeId}/calculate?${body}`, {
                headers: { Accept: 'application/json' },
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible de calculer le bulletin.');
            if (version !== calculationVersion) return false;
            renderPayroll(result.payroll || result);
            state.textContent = 'Aperçu · non enregistré';
            return true;
        } catch (failure) {
            if (version !== calculationVersion) return false;
            state.textContent = 'Calcul à vérifier';
            error.textContent = failure.message;
            error.hidden = false;
            return false;
        }
    }
    function previewWorkingTime() {
        clearTimeout(workingTimeTimer);
        clearTimeout(timer);
        calculateWorkingTime();
    }
    workingTimeInput?.addEventListener('blur', previewWorkingTime);
    workingTimeInput?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (workingTimeInput.reportValidity()) previewWorkingTime();
        }
    });

    form.addEventListener('input', event => {
        const saveButton = document.querySelector('#save-payroll-changes');
        if (saveButton) saveButton.textContent = 'Enregistrer les modifications';
        if (event.target instanceof HTMLInputElement
            && !event.target.matches('[name="nimpLabels"], [name="nimpAmounts"]')
            && !event.target.checkValidity()) {
            clearTimeout(timer);
            ++calculationVersion;
            document.querySelector('#calculation-state').textContent = 'Vérifiez la valeur saisie.';
            return;
        }
        if (event.target.matches('[name="nimpLabels"], [name="nimpAmounts"]')) {
            clearTimeout(timer);
            ++calculationVersion;
            if (event.target.name === 'nimpAmounts' && !event.target.checkValidity()) {
                document.querySelector('#calculation-state').textContent = 'Saisissez un montant valide.';
                return;
            }
            if (event.target.name === 'nimpLabels' && !event.target.value.trim()) {
                document.querySelector('#calculation-state').textContent = 'Saisissez un libellé valide.';
                return;
            }
            timer = setTimeout(() => calculate({ preserveIndemnityInputs: true, allowLocked: true }), 350);
            return;
        }
        if (event.target === workingTimeInput) {
            clearTimeout(workingTimeTimer);
            clearTimeout(timer);
            ++calculationVersion;
            if (workingTimeInput.checkValidity()) workingTimeTimer = setTimeout(() => calculateWorkingTime(), 350);
            else document.querySelector('#calculation-state').textContent = 'Saisissez une valeur de temps de travail valide.';
            return;
        }
        if (event.target.classList.contains('live-input') || event.target.name.includes('primes')) {
            clearTimeout(timer);
            ++calculationVersion;
            timer = setTimeout(calculate, 350);
        }
    });
    form.addEventListener('change', event => {
        if (event.target.matches('[name="nimpLabels"], [name="nimpAmounts"]')) return;
        if (event.target === workingTimeInput) return;
        if (event.target instanceof HTMLInputElement && !event.target.checkValidity()) return;
        clearTimeout(timer);
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
        if (!form.reportValidity()) return false;
        if (hasPaidLeaveConflict()) {
            showPaidLeaveConflictAlert();
            return false;
        }
        switchingEmployee = true;
        const state = document.querySelector('#calculation-state');
        const error = document.querySelector('#calculation-error');
        try {
            clearTimeout(timer);
            clearTimeout(workingTimeTimer);
            const previewed = workingTimeInput ? await calculateWorkingTime() : await calculate();
            if (!previewed) return false;
            const previewVersion = calculationVersion;
            await new Promise(resolve => requestAnimationFrame(resolve));
            if (calculationVersion !== previewVersion) return false;
            state.textContent = 'Enregistrement…';
            error.hidden = true;
            const submittedSignature = formSignature();
            const body = new URLSearchParams(new FormData(form));
            const response = await fetch(form.action, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                },
                body,
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible d’enregistrer les modifications.');
            savedFormSignature = submittedSignature;
            page.dataset.saved = 'true';
            const changesPending = hasPendingChanges();
            const saveButton = document.querySelector('#save-payroll-changes');
            if (saveButton) saveButton.textContent = changesPending ? 'Enregistrer les modifications' : 'Modifications enregistrées';
            state.textContent = changesPending ? 'Aperçu · non enregistré' : 'Enregistré';
            if (!changesPending) {
                sessionStorage.setItem(saveConfirmationStorageKey, 'true');
                showSavedConfirmation();
            }
            return !changesPending;
        } catch (failure) {
            state.textContent = 'Modification non enregistrée';
            error.textContent = failure.message;
            error.hidden = false;
            return false;
        } finally {
            switchingEmployee = false;
        }
    };
    document.querySelector('#save-payroll-changes')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            await saveBeforeSwitch();
        } finally {
            button.disabled = false;
        }
    });
    document.querySelector('#save-prime-rendement')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        const input = form.querySelector('[name="primeRendementInput"]');
        const status = document.querySelector('#prime-rendement-status');
        if (!input || !input.reportValidity()) return;
        button.disabled = true;
        status.textContent = 'Enregistrement…';
        try {
            const body = new URLSearchParams({
                month: page.dataset.month,
                year: page.dataset.year,
                primeRendementInput: input.value,
            });
            const response = await fetch(`/bulletins/${page.dataset.employeeId}/prime-rendement`, {
                method: 'POST',
                headers: { Accept: 'application/json' },
                body,
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible d’enregistrer la prime rendement.');
            input.value = Number(result.payroll?.primeRendementInput ?? input.value).toFixed(2);
            const savedEntries = JSON.parse(savedFormSignature);
            const fieldEntry = savedEntries.find(entry => entry[0] === 'primeRendementInput');
            if (fieldEntry) fieldEntry[1] = input.value;
            else savedEntries.push(['primeRendementInput', input.value]);
            savedFormSignature = JSON.stringify(savedEntries);
            await calculate();
            const changesPending = hasPendingChanges();
            status.textContent = changesPending ? 'Prime rendement enregistrée · autres modifications en attente' : 'Enregistrée';
            const saveButton = document.querySelector('#save-payroll-changes');
            if (saveButton && !changesPending) saveButton.textContent = 'Modifications enregistrées';
        } catch (error) {
            status.textContent = error.message || 'Erreur d’enregistrement.';
        } finally {
            button.disabled = false;
        }
    });
    window.addEventListener('beforeunload', event => {
        if (hasPendingChanges()) {
            event.preventDefault();
            event.returnValue = '';
        }
    });
    form.addEventListener('keydown', async event => {
        if (event.key !== 'Enter' || event.target.matches('textarea, button, select')) return;
        event.preventDefault();
        if (locked || !hasPendingChanges() || switchingEmployee) return;
        await saveBeforeSwitch();
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
