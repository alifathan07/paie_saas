(() => {
    const dialog = document.querySelector('#period-dialog');
    const openButton = document.querySelector('#open-period-dialog');
    const closeButton = document.querySelector('#close-period-dialog');
    const cancelButton = document.querySelector('#cancel-period-dialog');
    const form = document.querySelector('#period-dialog-form');
    const year = document.querySelector('#period-dialog-year');
    const month = document.querySelector('#period-dialog-month');
    const confirmButton = document.querySelector('#confirm-period-dialog');

    if (!dialog || !openButton || !form || !year || !month || !confirmButton) return;

    const original = { year: year.value, month: month.value };
    const updateState = () => {
        confirmButton.disabled = year.value === original.year && month.value === original.month;
    };
    const close = () => {
        if (dialog.open) dialog.close();
    };

    openButton.addEventListener('click', () => {
        year.value = original.year;
        month.value = original.month;
        updateState();
        dialog.showModal();
        year.focus();
    });
    year.addEventListener('change', updateState);
    month.addEventListener('change', updateState);
    closeButton?.addEventListener('click', close);
    cancelButton?.addEventListener('click', close);
    dialog.addEventListener('click', event => {
        if (event.target === dialog) close();
    });
    dialog.addEventListener('cancel', event => {
        event.preventDefault();
        close();
    });
    form.addEventListener('submit', event => {
        if (confirmButton.disabled) event.preventDefault();
    });

    const themeToggle = document.querySelector('[data-theme-toggle]');
    if (themeToggle) {
        const themeKey = 'paie-soft-theme';
        const applyTheme = muted => {
            document.body.classList.toggle('theme-muted', muted);
            themeToggle.setAttribute('aria-pressed', String(muted));
        };
        applyTheme(localStorage.getItem(themeKey) === 'true');
        themeToggle.addEventListener('click', () => {
            const muted = !document.body.classList.contains('theme-muted');
            localStorage.setItem(themeKey, String(muted));
            applyTheme(muted);
        });
    }
})();
