// Small DOM helpers. All dynamic text is set with textContent.

export function $(id) {
    return document.getElementById(id);
}

export function showToast(message, type = 'info', durationMs = 4000) {
    const container = $('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const text = document.createElement('div');
    text.textContent = String(message);
    toast.appendChild(text);
    container.appendChild(toast);
    while (container.children.length > 3) container.firstElementChild.remove();
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 200);
    }, durationMs);
}

export function announce(message) {
    const el = $('srStatus');
    if (!el) return;
    el.textContent = '';
    // A separate frame makes screen readers announce repeated identical messages.
    requestAnimationFrame(() => { el.textContent = message; });
}

export function setButtonBusy(button, busy, busyLabel) {
    const label = button.querySelector('.btn-label');
    if (busy) {
        if (label && !button.dataset.label) button.dataset.label = label.textContent;
        if (label && busyLabel) label.textContent = busyLabel;
        button.classList.add('is-loading');
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
    } else {
        if (label && button.dataset.label) label.textContent = button.dataset.label;
        delete button.dataset.label;
        button.classList.remove('is-loading');
        button.disabled = false;
        button.removeAttribute('aria-busy');
    }
}

export function flashLabel(button, text, ms = 2000) {
    const label = button.querySelector('.btn-label');
    if (!label) return;
    const original = button.dataset.flashOriginal || label.textContent;
    button.dataset.flashOriginal = original;
    label.textContent = text;
    clearTimeout(Number(button.dataset.flashTimer));
    button.dataset.flashTimer = String(setTimeout(() => {
        label.textContent = original;
        delete button.dataset.flashOriginal;
    }, ms));
}
