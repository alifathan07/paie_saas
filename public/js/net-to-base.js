(() => {
    const baseInput = document.querySelector('#baseSalary');
    const employeeForm = baseInput?.form;
    const dialog = document.querySelector('#net-to-base-dialog');
    if (!employeeForm || !dialog) return;
    const get = id => document.getElementById(`net-to-base-${id}`);
    const popupForm = get('form');
    const lines = get('lines');
    const target = get('target');
    const applyButton = get('apply');
    const calculateButton = get('calculate');
    const error = get('error');
    const state = get('state');
    const formState = get('form-state');
    const catalog = [...get('catalog').content.querySelectorAll('option')].map(option => ({
        id: Number(option.value), name: option.dataset.name, taxable: option.dataset.taxable === 'true',
    }));
    const money = value => `${Number(value).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
    let result = null;
    let sequence = 0;
    let pending;
    let calculatedInputs;
    // Preserve a saved contribution setting when the form has no visible control for it.
    if (!employeeForm.elements.cimrReduitBaseImposable && dialog.dataset.cimrReduction === 'true') {
        const hidden = document.createElement('input');
        hidden.type = 'hidden'; hidden.name = 'cimrReduitBaseImposable'; hidden.value = '1';
        employeeForm.append(hidden);
    }
    const field = name => employeeForm.elements.namedItem(name);
    const flag = name => {
        const input = field(name);
        return input?.type === 'checkbox' ? input.checked : input?.value === '1';
    };
    function invalidate() {
        ++sequence;
        pending?.abort();
        result = null;
        applyButton.disabled = false;
        calculateButton.disabled = false;
        get('result').hidden = true;
        state.textContent = '';
        error.hidden = true;
    }
    function showError(message) { error.textContent = message; error.hidden = false; }
    function periodLabel(month, year) {
        return new Date(year, month - 1, 15).toLocaleDateString('fr-MA', { month: 'long', year: 'numeric' });
    }
    function catalogSelections(taxable) {
        return [...employeeForm.querySelectorAll('[name="bonusIds"]:checked')].flatMap(input => {
            const bonus = catalog.find(item => item.id === Number(input.value));
            if (!bonus || bonus.taxable !== taxable) return [];
            return [{ bonusId: bonus.id, amount: input.closest('.bonus-row').querySelector('[name="bonusAmounts"]').value }];
        });
    }
    function addLine(item = {}) {
        const row = document.createElement('div'); row.className = 'net-to-base-line';
        const identity = document.createElement('div');
        const selectLabel = document.createElement('label'); selectLabel.textContent = 'Indemnité';
        const select = document.createElement('select'); select.className = 'form-input'; select.required = true;
        select.append(new Option('Choisir…', ''));
        catalog.filter(bonus => !bonus.taxable).forEach(bonus => select.append(new Option(bonus.name, String(bonus.id))));
        select.append(new Option('Nouvelle indemnité…', 'new'));
        selectLabel.append(select);
        const name = document.createElement('input'); name.className = 'form-input net-to-base-name';
        name.type = 'text'; name.maxLength = 191; name.placeholder = "Nom de l'indemnité";
        name.setAttribute('aria-label', "Nom de la nouvelle indemnité"); name.value = item.name || '';
        select.value = item.bonusId ? String(item.bonusId) : item.name !== undefined ? 'new' : '';
        function updateName() { name.hidden = name.disabled = select.value !== 'new'; name.required = select.value === 'new'; }
        updateName();
        select.addEventListener('change', updateName);
        identity.append(selectLabel, name);
        const amountLabel = document.createElement('label'); amountLabel.textContent = 'Montant (DH)';
        const amount = document.createElement('input'); amount.type = 'number'; amount.className = 'form-input';
        amount.min = '0.01'; amount.max = '9999999999.99'; amount.step = '0.01'; amount.required = true; amount.value = item.amount ?? '';
        amountLabel.append(amount);
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn-secondary';
        remove.textContent = '×'; remove.setAttribute('aria-label', "Retirer l'indemnité");
        remove.addEventListener('click', () => { row.remove(); invalidate(); });
        row.append(identity, amountLabel, remove); lines.append(row);
        return row;
    }
    function payload() {
        return {
            ...(dialog.dataset.employeeId ? { employeeId: Number(dialog.dataset.employeeId) } : {}),
            targetNet: target.value,
            dateEmbauche: field('dateEmbauche')?.value,
            nbPersonacharge: field('nbPersonacharge')?.value || '0',
            cimrRate: field('cimrRate')?.value || '',
            cimrReduitBaseImposable: flag('cimrReduitBaseImposable'),
            blocageSaisiePaie: flag('blocageSaisiePaie'),
            indemnities: [...lines.children].map(row => {
                const select = row.querySelector('select');
                return {
                    ...(select.value === 'new' ? { name: row.querySelector('input[type="text"]').value.trim() } : { bonusId: Number(select.value) }),
                    amount: row.querySelector('input[type="number"]').value,
                };
            }),
            taxableBonuses: catalogSelections(true),
        };
    }
    function updateBlocked() {
        get('open').disabled = flag('blocageSaisiePaie');
        formState.textContent = flag('blocageSaisiePaie') ? 'Calcul indisponible : la saisie de paie est bloquée.' : '';
    }
    field('blocageSaisiePaie')?.addEventListener('change', updateBlocked);
    updateBlocked();
    get('open').addEventListener('click', () => {
        if (flag('blocageSaisiePaie')) return;
        invalidate(); lines.replaceChildren();
        catalogSelections(false).forEach(addLine);
        employeeForm.querySelectorAll('[name="customBonusNames"]').forEach(input => {
            const amount = input.parentElement.querySelector('[name="customBonusAmounts"]');
            if (input.value.trim() || amount?.value) addLine({ name: input.value, amount: amount?.value || '' });
        });
        const taxable = catalogSelections(true);
        get('taxable').hidden = taxable.length === 0;
        get('taxable').textContent = `Primes imposables de la fiche incluses et conservées : ${money(taxable.reduce((sum, item) => sum + Number(item.amount || 0), 0))}.`;
        const now = new Date();
        get('assumptions').textContent = `Ancienneté calculée pour ${periodLabel(now.getMonth() + 1, now.getFullYear())}, à partir de la date d'embauche de la fiche.`;
        dialog.showModal(); target.focus();
    });
    get('add').addEventListener('click', () => { invalidate(); addLine().querySelector('select').focus(); });
    get('create').addEventListener('click', () => { invalidate(); addLine({ name: '' }).querySelector('input[type="text"]').focus(); });
    get('cancel').addEventListener('click', () => { invalidate(); dialog.close(); });
    dialog.addEventListener('cancel', invalidate);
    dialog.addEventListener('close', () => { if (!dialog.open) invalidate(); });
    popupForm.addEventListener('input', invalidate);
    popupForm.addEventListener('change', invalidate);
    async function calculate() {
        if (!popupForm.reportValidity()) return false;
        invalidate();
        const version = sequence;
        const inputs = payload();
        pending = new AbortController();
        calculateButton.disabled = true;
        applyButton.disabled = true;
        state.textContent = 'Calcul en cours…';
        try {
            const response = await fetch('/employees/net-to-base', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(inputs), signal: pending.signal,
            });
            const data = await response.json();
            if (version !== sequence) return false;
            if (!response.ok || !data.ok) throw new Error(data.error || 'Impossible de calculer le salaire.');
            result = data; calculatedInputs = JSON.stringify(inputs);
            const amounts = {
                ...data.payroll, baseSalary: data.baseSalary,
                indemnities: data.payroll.bonusesNIMP, net: data.payroll.netAPayer, difference: data.difference,
            };
            dialog.querySelectorAll('[data-net-result]').forEach(node => { node.textContent = money(amounts[node.dataset.netResult]); });
            get('rounding').textContent = data.exact ? 'Le net calculé correspond au net souhaité.' : 'Montant le plus proche : les arrondis ou seuils empêchent une correspondance exacte. Vérifiez l’écart avant d’appliquer.';
            get('assumptions').textContent = `Ancienneté calculée pour ${periodLabel(data.period.month, data.period.year)}. Mois complet de 26 jours.`;
            get('result').hidden = false; applyButton.disabled = false; state.textContent = 'Calcul terminé.';
            return true;
        } catch (failure) {
            if (version === sequence && failure.name !== 'AbortError') {
                state.textContent = ''; showError(failure.message || 'Erreur de connexion. Réessayez.');
            }
            return false;
        } finally {
            if (version === sequence) {
                calculateButton.disabled = false;
                applyButton.disabled = false;
            }
        }
    }
    function applyToFiche() {
        if (!result) return false;
        if (calculatedInputs !== JSON.stringify(payload())) { invalidate(); showError('Les données ont changé. Relancez le calcul.'); return false; }
        const selections = new Map(result.indemnities.filter(item => item.bonusId).map(item => [String(item.bonusId), item]));
        const checkboxMap = new Map([...employeeForm.querySelectorAll('[name="bonusIds"]')].map(input => [input.value, input]));
        if ([...selections.keys()].some(id => !checkboxMap.has(id))) { showError('Le catalogue a changé. Rechargez la fiche avant d’appliquer.'); return false; }
        const newContainer = employeeForm.querySelector('#new-bonus-rows');
        const newRows = result.indemnities.filter(item => !item.bonusId).map(item => {
            const row = document.createElement('div'); row.className = 'net-to-base-custom-row';
            const name = document.createElement('input'); name.type = 'text'; name.name = 'customBonusNames'; name.className = 'form-input'; name.value = item.name; name.setAttribute('aria-label', "Nom de l'indemnité");
            const amount = document.createElement('input'); amount.type = 'number'; amount.name = 'customBonusAmounts'; amount.className = 'form-input'; amount.min = '0.01'; amount.step = '0.01'; amount.value = item.amount.toFixed(2); amount.setAttribute('aria-label', "Montant de l'indemnité");
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn-secondary'; remove.textContent = '×'; remove.setAttribute('aria-label', "Retirer l'indemnité"); remove.addEventListener('click', () => row.remove());
            row.append(name, amount, remove); return row;
        });
        for (const bonus of catalog.filter(item => !item.taxable)) {
            const checkbox = checkboxMap.get(String(bonus.id));
            if (!checkbox) continue;
            const selection = selections.get(String(bonus.id));
            const amount = checkbox.closest('.bonus-row').querySelector('[name="bonusAmounts"]');
            checkbox.checked = Boolean(selection); amount.disabled = !selection; amount.required = Boolean(selection);
            if (selection) amount.value = selection.amount.toFixed(2);
        }
        newContainer.replaceChildren(...newRows);
        baseInput.value = result.baseSalary.toFixed(2);
        baseInput.dispatchEvent(new Event('input', { bubbles: true }));
        baseInput.dispatchEvent(new Event('change', { bubbles: true }));
        formState.textContent = `Salaire de base : ${money(result.baseSalary)}.`;
        dialog.close(); baseInput.focus();
        return true;
    }
    popupForm.addEventListener('submit', async event => {
        event.preventDefault();
        await calculate();
    });
    get('apply').addEventListener('click', async () => {
        if (!popupForm.reportValidity()) return;
        if (!result || calculatedInputs !== JSON.stringify(payload())) {
            const ok = await calculate();
            if (!ok) return;
        }
        applyToFiche();
    });
})();
