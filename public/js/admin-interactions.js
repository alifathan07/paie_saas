(() => {
    function closeModal(modal) {
        modal?.remove();
    }

    function openBlockModal(form) {
        const modal = document.createElement("div");
        modal.className = "admin-block-modal";
        modal.innerHTML = `
            <div class="admin-block-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-block-title">
                <button type="button" class="admin-block-close" aria-label="Fermer">×</button>
                <div class="admin-block-icon">!</div>
                <p class="admin-block-eyebrow">SÉCURITÉ DU COMPTE</p>
                <h2 id="admin-block-title">Bloquer ce client ?</h2>
                <p class="admin-block-help">Écrivez la raison. Elle sera reformulée en un message court et professionnel en français.</p>
                <label class="admin-block-label" for="admin-block-reason">Motif du blocage</label>
                <textarea id="admin-block-reason" class="admin-block-reason" maxlength="500" rows="4"></textarea>
                <div class="admin-block-actions">
                    <button type="button" class="btn-secondary admin-block-cancel">Annuler</button>
                    <button type="button" class="btn-primary admin-block-confirm">Bloquer le compte</button>
                </div>
            </div>`;

        const reason = modal.querySelector(".admin-block-reason");
        reason.value = form.dataset.defaultReason || "Paiement en attente";
        document.body.append(modal);
        requestAnimationFrame(() => reason.focus());

        modal.querySelector(".admin-block-close").addEventListener("click", () => closeModal(modal));
        modal.querySelector(".admin-block-cancel").addEventListener("click", () => closeModal(modal));
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeModal(modal);
        });
        modal.querySelector(".admin-block-confirm").addEventListener("click", () => {
            const hiddenReason = form.querySelector("[name=reason]") || document.createElement("input");
            hiddenReason.type = "hidden";
            hiddenReason.name = "reason";
            hiddenReason.value = reason.value.trim() || form.dataset.defaultReason || "Paiement en attente";
            if (!hiddenReason.parentNode) form.append(hiddenReason);
            closeModal(modal);
            form.submit();
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        document.querySelectorAll(".block-user-form").forEach((form) => {
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                openBlockModal(form);
            });
        });
    });
})();

