export function createSummaryStore({ metadata, saveMetadata, clock = Date } = {}) {
    if (!metadata || typeof metadata !== 'object') throw new TypeError('Summary store requires chat metadata.');
    if (typeof saveMetadata !== 'function') throw new TypeError('Summary store requires saveMetadata().');

    const listeners = new Set();

    function bucket() {
        metadata.nemolore ??= {};
        metadata.nemolore.summaries ??= {};
        return metadata.nemolore.summaries;
    }

    function emit(event, record) {
        for (const listener of listeners) listener(event, record);
    }

    async function save(chatId, input) {
        const previous = bucket()[String(chatId)] ?? null;
        const record = Object.freeze({
            chatId: String(chatId),
            text: String(input.text ?? '').trim(),
            sourceMessageIds: [...new Set(input.sourceMessageIds ?? [])],
            sourceRange: input.sourceRange ?? null,
            paired: Boolean(input.paired),
            createdAt: input.createdAt ?? previous?.createdAt ?? clock.now(),
            updatedAt: clock.now(),
            metadata: structuredClone(input.metadata ?? {}),
        });
        if (!record.text) throw new TypeError('Summary text is required.');
        bucket()[record.chatId] = record;
        await saveMetadata();
        emit(previous ? 'updated' : 'saved', record);
        return record;
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') throw new TypeError('Summary listener must be a function.');
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    return Object.freeze({
        save,
        subscribe,
        get: chatId => bucket()[String(chatId)] ?? null,
        list: () => Object.values(bucket()),
        async remove(chatId) {
            const key = String(chatId);
            const existing = bucket()[key] ?? null;
            delete bucket()[key];
            if (existing) {
                await saveMetadata();
                emit('removed', existing);
            }
            return Boolean(existing);
        },
    });
}
