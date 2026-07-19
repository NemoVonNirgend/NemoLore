function createButtonMarkup(buttons) {
    return buttons
        .map(({ action, text }) => `<button class="nemolore-btn" data-action="${action}">${text}</button>`)
        .join('');
}

export function createNotificationCenter({ logger }) {
    const activeNotifications = new Set();

    function show(message, buttons = [], timeout = 10_000) {
        return new Promise((resolve) => {
            const notification = document.createElement('div');
            notification.className = 'nemolore-notification';
            notification.innerHTML = `
                <div class="nemolore-notification-content">
                    <p></p>
                    <div class="nemolore-notification-buttons">${createButtonMarkup(buttons)}</div>
                </div>
            `;

            const messageElement = notification.querySelector('p');
            if (messageElement) messageElement.textContent = String(message);

            document.body.appendChild(notification);
            activeNotifications.add(notification);

            let settled = false;
            let timeoutId = null;

            const settle = (result) => {
                if (settled) return;
                settled = true;
                if (timeoutId) clearTimeout(timeoutId);
                activeNotifications.delete(notification);
                notification.remove();
                resolve(result);
            };

            timeoutId = setTimeout(() => settle('timeout'), timeout);

            notification.addEventListener('click', (event) => {
                const target = event.target instanceof Element
                    ? event.target.closest('[data-action]')
                    : null;
                if (!target) return;
                settle(target.getAttribute('data-action'));
            });

            logger.debug('Notification displayed.', { buttonCount: buttons.length });
        });
    }

    function clearAll() {
        for (const notification of activeNotifications) notification.remove();
        activeNotifications.clear();
    }

    return Object.freeze({ show, clearAll });
}
