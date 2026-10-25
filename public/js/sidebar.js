(() => {
    const sidebar = document.querySelector('#app-sidebar');
    const toggle = document.querySelector('#sidebar-toggle');
    if (!sidebar || !toggle) return;

    const storageKey = 'paie-sidebar-collapsed';
    const mobile = () => window.matchMedia('(max-width: 768px)').matches;

    const applyState = collapsed => {
        document.body.classList.toggle('sidebar-collapsed', collapsed);
        document.body.classList.toggle('sidebar-expanded', !collapsed);
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', collapsed ? 'Ouvrir le menu' : 'Réduire le menu');
        toggle.textContent = collapsed ? '›' : '‹';
    };

    const stored = localStorage.getItem(storageKey);
    applyState(stored === null ? mobile() : stored === 'true');

    toggle.addEventListener('click', () => {
        const collapsed = !document.body.classList.contains('sidebar-collapsed');
        localStorage.setItem(storageKey, String(collapsed));
        applyState(collapsed);
    });

    window.addEventListener('resize', () => {
        if (mobile() && !localStorage.getItem(storageKey)) applyState(true);
    });
})();
