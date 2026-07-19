function normalizeSource(source) {
    if (!source || typeof source !== 'object') {
        throw new TypeError('Source must be an object.');
    }

    const chatId = String(source.chatId ?? '').trim();
    const messageId = String(source.messageId ?? source.messageIndex ?? '').trim();
    if (!chatId || !messageId) {
        throw new TypeError('Source requires chatId and messageId.');
    }

    return Object.freeze({
        id: source.id ?? `${chatId}:${messageId}`,
        chatId,
        messageId,
        messageIndex: Number.isInteger(source.messageIndex) ? source.messageIndex : null,
        role: source.role ?? null,
        author: source.author ?? null,
        hash: source.hash ?? null,
        createdAt: source.createdAt ?? new Date().toISOString(),
        metadata: structuredClone(source.metadata ?? {}),
    });
}

export function createSourceLedger({ logger } = {}) {
    const sources = new Map();
    const memoryLinks = new Map();

    function register(source) {
        const normalized = normalizeSource(source);
        const existing = sources.get(normalized.id);

        if (existing?.hash && normalized.hash && existing.hash !== normalized.hash) {
            logger?.warn('Source content changed after registration.', { sourceId: normalized.id });
        }

        sources.set(normalized.id, normalized);
        return normalized;
    }

    function link(memoryId, sourceIds) {
        if (!memoryId) throw new TypeError('memoryId is required.');
        const ids = new Set(sourceIds ?? []);

        for (const sourceId of ids) {
            if (!sources.has(sourceId)) {
                throw new Error(`Cannot link unknown source: ${sourceId}`);
            }
        }

        memoryLinks.set(memoryId, ids);
        return [...ids];
    }

    function unlink(memoryId) {
        return memoryLinks.delete(memoryId);
    }

    function get(sourceId) {
        return sources.get(sourceId) ?? null;
    }

    function getForMemory(memoryId) {
        return [...(memoryLinks.get(memoryId) ?? [])]
            .map(sourceId => sources.get(sourceId))
            .filter(Boolean);
    }

    function memoriesForSource(sourceId) {
        const result = [];
        for (const [memoryId, sourceIds] of memoryLinks) {
            if (sourceIds.has(sourceId)) result.push(memoryId);
        }
        return result;
    }

    function remove(sourceId) {
        const affectedMemoryIds = memoriesForSource(sourceId);
        sources.delete(sourceId);
        for (const memoryId of affectedMemoryIds) {
            const links = memoryLinks.get(memoryId);
            links?.delete(sourceId);
        }
        return affectedMemoryIds;
    }

    return Object.freeze({
        register,
        link,
        unlink,
        get,
        getForMemory,
        memoriesForSource,
        remove,
        has: sourceId => sources.has(sourceId),
        list: () => [...sources.values()],
        clear() {
            sources.clear();
            memoryLinks.clear();
        },
    });
}
