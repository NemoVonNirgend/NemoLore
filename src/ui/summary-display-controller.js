function findTargetMessage(record, root) {
    const endIndex = record?.sourceRange?.end;
    if (Number.isInteger(endIndex)) {
        const match = [...root.querySelectorAll('.mes')]
            .find(element => Number(element.getAttribute('mesid')) === endIndex);
        if (match) return match;
    }
    return root.querySelector('.mes:last-child') ?? root;
}

export function createSummaryDisplayController({
    summaryStore,
    settings,
    getChatId,
    eventSource,
    chatChangedEvent,
    chatLoadedEvent,
    logger,
} = {}) {
    if (!summaryStore?.subscribe) throw new TypeError('Summary display requires an observable summary store.');
    if (eventSource != null && typeof eventSource.on !== 'function') {
        throw new TypeError('Summary display event source must support on().');
    }

    let installed = false;
    let unsubscribe = null;
    let element = null;
    const chatEvents = [...new Set([chatChangedEvent, chatLoadedEvent].filter(Boolean))];

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

    function onChatChanged(eventChatId) {
        const chatId = typeof eventChatId === 'string' || typeof eventChatId === 'number'
            ? eventChatId
            : getChatId?.();
        refresh(chatId);
    }

    function install() {
        if (installed) return false;
        unsubscribe = summaryStore.subscribe((event, record) => {
            if (record?.chatId !== String(getChatId?.() ?? record.chatId)) return;
            if (event === 'removed') remove();
            else render(record);
        });
        for (const event of chatEvents) eventSource?.on(event, onChatChanged);
        installed = true;
        refresh();
        return true;
    }

    function uninstall() {
        if (!installed) return false;
        unsubscribe?.();
        unsubscribe = null;
        for (const event of chatEvents) {
            if (typeof eventSource?.removeListener === 'function') {
                eventSource.removeListener(event, onChatChanged);
            } else {
                eventSource?.off?.(event, onChatChanged);
            }
        }
        installed = false;
        remove();
        return true;
    }

    return Object.freeze({
        install,
        uninstall,
        refresh,
        render,
        remove,
        get element() { return element; },
        get installed() { return installed; },
    });
}
