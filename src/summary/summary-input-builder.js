function normalizeMessage(message, index) {
    if (!message) return null;
    const role = message.role
        ?? (message.is_user ? 'user' : 'assistant');
    const text = String(message.text ?? message.mes ?? '').trim();
    if (!text) return null;

    return Object.freeze({
        id: String(message.id ?? message.messageId ?? message.send_date ?? index),
        index,
        role,
        text,
        name: message.name ?? null,
        createdAt: message.createdAt ?? message.send_date ?? null,
        metadata: structuredClone(message.metadata ?? message.extra ?? {}),
    });
}

export function createSummaryInputBuilder({ settings, logger } = {}) {
    function build({ chat = [], assistantIndex = chat.length - 1, previousSummary = null } = {}) {
        const normalized = chat
            .map(normalizeMessage)
            .filter(message => message && message.index <= assistantIndex);

        const maxMessages = Math.max(2, Number(settings?.summaryInputMaxMessages ?? settings?.runningMemorySize ?? 50));
        const messages = normalized.slice(-maxMessages);
        const result = Object.freeze({
            messages,
            sourceRange: messages.length
                ? Object.freeze({ start: messages[0].index, end: messages.at(-1).index })
                : null,
            previousSummary: previousSummary?.text ?? previousSummary ?? '',
            paired: Boolean(settings?.enablePairedSummarization),
            totalMessages: normalized.length,
            selectedMessages: messages.length,
        });

        logger?.debug('Built summary input window.', {
            selected: result.selectedMessages,
            total: result.totalMessages,
            sourceRange: result.sourceRange,
        });
        return result;
    }

    return Object.freeze({ build });
}
