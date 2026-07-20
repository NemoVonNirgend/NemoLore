export function createContextExclusionPolicy({ settings, logger } = {}) {
    function selectVisibleRange({ chatLength = 0, summaryAvailable = false } = {}) {
        const runningMemorySize = Math.max(1, Number(settings?.runningMemorySize ?? 50));
        const enabled = Boolean(settings?.hideMessagesWhenThreshold && summaryAvailable);
        const startIndex = enabled ? Math.max(0, chatLength - runningMemorySize) : 0;

        return Object.freeze({
            enabled,
            startIndex,
            endIndex: Math.max(0, chatLength - 1),
            hiddenCount: startIndex,
            visibleCount: Math.max(0, chatLength - startIndex),
            reason: enabled ? 'summary-running-window' : 'disabled',
        });
    }

    function apply(chat = [], options = {}) {
        const decision = selectVisibleRange({
            chatLength: chat.length,
            summaryAvailable: options.summaryAvailable,
        });

        const visible = chat.slice(decision.startIndex);
        const hidden = chat.slice(0, decision.startIndex);
        logger?.debug('Applied context exclusion policy.', decision);

        return Object.freeze({
            ...decision,
            visible,
            hidden,
        });
    }

    return Object.freeze({ selectVisibleRange, apply });
}
