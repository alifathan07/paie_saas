(function () {
    const meta = document.querySelector('meta[name="csrf-token"]');
    const token = meta?.content;
    if (!token) return;

    document.querySelectorAll('form').forEach((form) => {
        const method = (form.getAttribute('method') || 'get').toUpperCase();
        if (method === 'GET' || form.querySelector('input[name="_csrf"]')) return;
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = '_csrf';
        input.value = token;
        form.appendChild(input);
    });

    const originalFetch = window.fetch;
    window.fetch = function (input, init = {}) {
        const url = typeof input === 'string' ? new URL(input, window.location.href) : new URL(input.url, window.location.href);
        const method = (init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
        if (url.origin === window.location.origin && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
            const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
            if (!headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token);
            init.headers = headers;
        }
        return originalFetch.call(this, input, init);
    };

    document.body.addEventListener('htmx:configRequest', (event) => {
        event.detail.headers['X-CSRF-Token'] = token;
    });
})();
