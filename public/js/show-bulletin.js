(() => {
    const page = document.querySelector('.payroll-print');
    const form = document.querySelector('#payroll-form');
    const lines = document.querySelector('#prime-lines');
    if (!page || !form) return;

    const locked = page.dataset.locked === 'true';
    const money = value => `${Number(value || 0).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD`;
    const days = value => Number(value || 0).toLocaleString('fr-MA', { maximumFractionDigits: 0 });
    const setResult = (name, value) => document.querySelectorAll(`[data-result="${name}"]`).forEach(node => {
        node.textContent = money(value);
    });
    const setAnnualCumulative = cumulative => {
        if (!cumulative) return;
        document.querySelectorAll('[data-result="annualWorkedDays"]').forEach(node => { node.textContent = days(cumulative.workedDays); });
        ['sbi', 'sni', 'irNet', 'cnss', 'amo'].forEach(key => {
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
        const amount = Number(primeAmountInput.value);
        const submitButton = event.submitter;
        submitButton.disabled = true;
        submitButton.textContent = 'Enregistrement...';
        try {
            const response = await fetch(`/bulletins/${page.dataset.employeeId}/primes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ label, amount, month: page.dataset.month, year: page.dataset.year })
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Impossible d’enregistrer la prime.');

            const row = document.createElement('tr');
            row.className = 'prime-row taxable-prime-line';
            const escapedLabel = label.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const escapedValue = label.replace(/"/g, '&quot;');
            const savedAmount = Number(result.bonus.amount).toFixed(2);
            row.innerHTML = `<td class="description"><input name="primesLabels" value="${escapedValue}" placeholder="Nom de la prime"></td><td class="num">—</td><td class="num">—</td><td class="num"><input class="live-input" name="primesAmounts" type="number" min="0" step="0.01" value="${savedAmount}" placeholder="Montant DH"></td><td class="num">—</td><td class="num"><button type="button" class="remove-prime" aria-label="Supprimer">×</button></td>`;
            const primeRows = lines.querySelectorAll('.prime-row');
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

    const indemnityDialog = document.querySelector('#indemnity-dialog');
    const indemnityDialogForm = document.querySelector('#indemnity-dialog-form');
    const indemnityLabelInput = document.querySelector('#indemnity-label-input');
    const indemnityAmountInput = document.querySelector('#indemnity-amount-input');
    document.querySelector('#add-indemnity')?.addEventListener('click', () => {
        indemnityDialog?.showModal();
        indemnityLabelInput?.focus();
    });
    document.querySelector('#indemnity-dialog-cancel')?.addEventListener('click', () => indemnityDialog?.close());
    indemnityDialogForm?.addEventListener('submit', async event => {
        if (event.submitter?.value !== 'add') return;
        event.preventDefault();
        const label = indemnityLabelInput.value.trim();
        const amount = Number(indemnityAmountInput.value);
        const submitButton = event.submitter;
        submitButton.disabled = true;
        submitButton.textContent = 'Enregistrement...';
        try {
            const response = await fetch(`/bulletins/${page.dataset.employeeId}/indemnities`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ label, amount, month: page.dataset.month, year: page.dataset.year })
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || "Impossible d'enregistrer l'indemnité.");
            indemnityDialogForm.reset();
            indemnityDialog?.close();
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
        const row = event.target.closest('.monthly-indemnity-line');
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
                    month: page.dataset.month,
                    year: page.dataset.year,
                }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || "Impossible de modifier l'indemnité.");
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
            if (!(await confirmDeletion(`Voulez-vous vraiment supprimer l'indemnité non imposable « ${label} » ?`))) return;
            const removeButton = event.target;
            removeButton.disabled = true;
            try {
                const response = await fetch(`/bulletins/${page.dataset.employeeId}/indemnities/delete`, {
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
        ['baseSalary', 'sbg', 'sbi', 'sni', 'cnss', 'amo', 'irNet', 'fraisPro', 'netAPayer', 'primeAnciennete', 'cnssPatronale', 'amoPatronale'].forEach(key => setResult(key, result[key]));
        document.querySelectorAll('[data-result="arrondiGains"]').forEach(node => { node.textContent = Number(result.arrondi || 0) > 0 ? money(result.arrondi) : '—'; });
        document.querySelectorAll('[data-result="arrondiRetenues"]').forEach(node => { node.textContent = Number(result.arrondi || 0) < 0 ? money(Math.abs(result.arrondi)) : '—'; });
        document.querySelectorAll('[data-result="fraisProRate"]').forEach(node => {
            node.textContent = `${Number(Number(result.fraisProRate || 0) * 100).toLocaleString('fr-MA', { maximumFractionDigits: 2 })}%`;
        });
        setAnnualCumulative(result.annualCumulative);
        document.querySelectorAll('[data-result="periode"]').forEach(element => {
            element.textContent = result.periode;
        });
        const deductions = Number(result.cnss || 0) + Number(result.amo || 0) + Number(result.cimr || 0) + Number(result.irNet || 0) + Number(result.avances || 0) + Math.max(0, -Number(result.arrondi || 0));
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

    const workedDaysInput = form.elements.workedDays;
    let savedDays = workedDaysInput?.value;
    let savingDays = false;
    let daysTimer;
    async function calculateDays(save = false) {
        if (!workedDaysInput || workedDaysInput.disabled || savingDays || !workedDaysInput.checkValidity()) return;
        const version = ++calculationVersion;
        const state = document.querySelector('#calculation-state');
        const error = document.querySelector('#calculation-error');
        const body = new URLSearchParams({ month: page.dataset.month, year: page.dataset.year, workedDays: workedDaysInput.value });
        if (save) { savingDays = true; workedDaysInput.readOnly = true; }
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
            if (save) savedDays = body.get('workedDays');
            if (version !== calculationVersion) return;
            renderPayroll(result.payroll);
            state.textContent = save ? 'Jours enregistrés' : 'Aperçu · jours non enregistrés';
        } catch (failure) {
            if (version !== calculationVersion) return;
            state.textContent = 'Modification non enregistrée';
            error.textContent = failure.message;
            error.hidden = false;
        } finally {
            if (save) { savingDays = false; workedDaysInput.readOnly = false; }
        }
    }
    function saveDays() {
        clearTimeout(daysTimer);
        clearTimeout(timer);
        if (page.dataset.saved === 'true' && workedDaysInput.value !== savedDays) calculateDays(true);
    }
    workedDaysInput?.addEventListener('blur', saveDays);
    workedDaysInput?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            if (workedDaysInput.reportValidity()) saveDays();
        }
    });
    window.addEventListener('beforeunload', event => {
        if (workedDaysInput && !workedDaysInput.disabled && workedDaysInput.value !== savedDays) {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    form.addEventListener('input', event => {
        if (event.target === workedDaysInput && page.dataset.saved === 'true') {
            clearTimeout(daysTimer);
            clearTimeout(timer);
            ++calculationVersion;
            if (workedDaysInput.checkValidity()) daysTimer = setTimeout(() => calculateDays(), 350);
            else document.querySelector('#calculation-state').textContent = 'Saisissez un nombre entier de 0 à 26.';
            return;
        }
        if (event.target.classList.contains('live-input') || event.target.name.includes('primes')) {
            clearTimeout(timer);
            timer = setTimeout(calculate, 350);
        }
    });
    form.addEventListener('change', event => {
        if (event.target === workedDaysInput && page.dataset.saved === 'true') return;
        calculate();
    });
    if (page.dataset.saved !== 'true') calculate();
})();
