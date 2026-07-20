const SCHEMA_VERSION = 1;

export function createMemoryPersistence({
    store,
    metadata,
    saveMetadata,
    logger,
    clock = Date,
    debounceMs = 250,
} = {}) {
    if (!store?.exportRecords || !store?.importRecords) throw new TypeError('Memory persistence requires a serializable store.');
    if (!metadata || typeof metadata !== 'object') throw new TypeError('Memory persistence requires mutable chat metadata.');
    if (typeof saveMetadata !== 'function') throw new TypeError('Memory persistence requires saveMetadata().');

    let timer = null;
    let pending = null;
    let unsubscribe = null;
    let activeChatId = null;

    function container() {
        metadata.nemolore ??= {};
        metadata.nemolore.memory ??= {};
        return metadata.nemolore.memory;
    }

    async function persist(chatId = activeChatId) {
        if (!chatId) return null;
        const target = container();
        target.schemaVersion = SCHEMA_VERSION;
        target.chatId = String(chatId);
        target.updatedAt = clock.now();
        target.records = store.exportRecords();
        await saveMetadata();
        logger?.debug('Persisted NemoLore memory.', { chatId, count: target.records.length });
        return structuredClone(target);
    }

    function schedule(chatId = activeChatId) {
        if (!chatId) return Promise.resolve(null);
        clearTimeout(timer);
        pending ??= new Promise((resolve, reject) => {
            timer = setTimeout(async () => {
                try { resolve(await persist(chatId)); } catch (error) { reject(error); } finally { pending = null; }
            }, debounceMs);
        });
        return pending;
    }

    function load(chatId) {
        activeChatId = chatId ? String(chatId) : null;
        const saved = metadata.nemolore?.memory;
        if (!saved || saved.chatId !== activeChatId || !Array.isArray(saved.records)) {
            store.clear({ silent: true });
            return [];
        }
        return store.importRecords(saved.records, { replace: true, silent: true });
    }

    async function flush() {
        clearTimeout(timer);
        timer = null;
        if (pending) return pending;
        return persist();
    }

    function start(chatId) {
        activeChatId = chatId ? String(chatId) : activeChatId;
        if (!unsubscribe) unsubscribe = store.subscribe(() => { void schedule(); });
        return load(activeChatId);
    }

    function stop() {
        unsubscribe?.();
        unsubscribe = null;
        clearTimeout(timer);
        timer = null;
        pending = null;
    }

    return Object.freeze({
        start,
        stop,
        load,
        persist,
        schedule,
        flush,
        get activeChatId() { return activeChatId; },
        schemaVersion: SCHEMA_VERSION,
    });
}
