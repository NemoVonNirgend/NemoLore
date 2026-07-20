function findTargetMessage(record, root) {
    const endIndex = record?.sourceRange?.end;
    if (Number.isInteger(endIndex)) {
        const match = [...root.querySelectorAll('.mes')]
            .find(element => Number(element.getAttribute('mesid')) === endIndex);
        if (match) return match;
    }
    return root.querySelector('.mes:last-child') ?? root;
}

export function createSummaryDisplayController({ summaryStore, settings, getChatId, logger } = {}) {
    if (!summaryStore?.subscribe) throw new TypeError('Summary display requires an observable summary store.');

    let unsubscribe = null;
    let element = null;

    function remove() {
        element?.remove();
        element = null;
    }

    function render(record) {
        remove();
        if (!record?.text || !settings?.showSummariesInChat) return false;
        const chatRoot = document.querySelector('#chat');
        if (!chatRoot) return false;

        element = document.createElement('div');
        element.className = 'mes_narration nemolore-modular-summary';
        element.dataset.nemoloreSummary = record.chatId;

        const heading = document.createElement('strong');
        heading.textContent = 'NemoLore Summary';
        const content = document.createElement('div');
        content.className = 'nemolore-modular-summary-text';
        content.textContent = record.text;
        element.append(heading, content);

        findTargetMessage(record, chatRoot).append(element);
        logger?.debug('Rendered modular summary display.', { chatId: record.chatId });
        return true;
    }

    function refresh(chatId = getChatId?.()) {
        const record = chatId ? summaryStore.get(chatId) : null;
        return record ? render(record) : (remove(), false);
    }

    function install() {
        if (unsubscribe) return false;
        unsubscribe = summaryStore.subscribe((event, record) => {
            if (event === 'removed') remove();
            else if (record?.chatId === String(getChatId?.() ?? record.chatId)) render(record);
        });
        refresh();
        return true;
    }

    function uninstall() {
        unsubscribe?.();
        unsubscribe = null;
        remove();
    }

    return Object.freeze({ install, uninstall, refresh, render, remove, get element() { return element; } });
}
