export function createSummaryStore({ metadata, saveMetadata, clock = Date } = {}) {
    if (!metadata || typeof metadata !== 'object') throw new TypeError('Summary store requires chat metadata.');
    if (typeof saveMetadata !== 'function') throw new TypeError('Summary store requires saveMetadata().');

    function bucket() {
        metadata.nemolore ??= {};
        metadata.nemolore.summaries ??= {};
        return metadata.nemolore.summaries;
    }

    async function save(chatId, input) {
        const record = Object.freeze({
            chatId: String(chatId),
            text: String(input.text ?? '').trim(),
            sourceMessageIds: [...new Set(input.sourceMessageIds ?? [])],
            sourceRange: input.sourceRange ?? null,
            paired: Boolean(input.paired),
            createdAt: input.createdAt ?? clock.now(),
            updatedAt: clock.now(),
            metadata: structuredClone(input.metadata ?? {}),
        });
        if (!record.text) throw new TypeError('Summary text is required.');
        bucket()[record.chatId] = record;
        await saveMetadata();
        return record;
    }

    return Object.freeze({
        save,
        get: chatId => bucket()[String(chatId)] ?? null,
        list: () => Object.values(bucket()),
        async remove(chatId) {
            const key = String(chatId);
            const existed = Boolean(bucket()[key]);
            delete bucket()[key];
            if (existed) await saveMetadata();
            return existed;
        },
    });
}
