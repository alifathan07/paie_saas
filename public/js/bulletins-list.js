(() => {
    const money = value => `${Number(value).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
    let dirtyRows = 0;
    window.addEventListener('beforeunload', event => {
        if (dirtyRows) { event.preventDefault(); event.returnValue = ''; }
    });
    document.querySelectorAll('.bulletin-row').forEach(row => {
        row.addEventListener('click', event => {
            if (event.target.closest('a, button, input, form, select')) return;
            window.location.href = row.dataset.href;
        });
        const form = row.querySelector('.worked-days-form');
        if (!form) return;
        const input = form.elements.workedDays;
        const message = form.querySelector('.worked-days-message');
        const sbi = row.querySelector('[data-payroll-sbi]');
        const net = row.querySelector('[data-payroll-net]');
        let savedDays = input.value;
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
                    savedDays = input.value;
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
            setDirty(input.value !== savedDays);
            restoreAmounts();
            if (!input.checkValidity()) {
                message.textContent = 'Saisissez un nombre entier de 0 à 26.';
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
})();
