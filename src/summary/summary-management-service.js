export function createSummaryManagementService({ store, summary, settings, getChatId, getContext, logger } = {}) {
    if (!store?.get || !store?.save) throw new TypeError('Summary management requires a summary store.');

    function current(chatId = getChatId?.()) {
        return chatId ? store.get(chatId) : null;
    }

    async function edit(text, { chatId = getChatId?.(), metadata = {} } = {}) {
        if (!chatId) throw new TypeError('Summary edit requires chatId.');
        const existing = store.get(chatId);
        return store.save(chatId, {
            ...(existing ?? {}),
            text,
            metadata: {
                ...(existing?.metadata ?? {}),
                ...metadata,
                manuallyEdited: true,
                editedAt: new Date().toISOString(),
            },
        });
    }

    async function regenerate({ chatId = getChatId?.(), provider, messages, sourceRange } = {}) {
        if (!summary?.summarize) throw new Error('Summary generation is unavailable.');
        const context = getContext?.() ?? {};
        const selected = messages ?? context.chat ?? [];
        return summary.summarize({
            chatId,
            provider,
            messages: selected,
            sourceRange,
            previousSummary: store.get(chatId)?.text ?? '',
            metadata: { manualRegeneration: true },
        });
    }

    function lineage(chatId = getChatId?.()) {
        const record = current(chatId);
        return record ? Object.freeze({
            chatId: record.chatId,
            sourceRange: record.sourceRange,
            sourceMessageIds: record.sourceMessageIds,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            metadata: structuredClone(record.metadata ?? {}),
        }) : null;
    }

    function setPrecedence(value) {
        const allowed = new Set(['new-first', 'legacy-first', 'new-only', 'legacy-only']);
        if (!allowed.has(value)) throw new TypeError(`Unknown summary precedence: ${value}`);
        settings.summaryContextPrecedence = value;
        logger?.debug('Updated summary precedence.', { value });
        return value;
    }

    return Object.freeze({ current, edit, regenerate, lineage, setPrecedence });
}
