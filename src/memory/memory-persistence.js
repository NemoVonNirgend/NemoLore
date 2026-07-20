import { createChatMetadataAccessor } from '../core/chat-metadata-accessor.js';

const SCHEMA_VERSION = 2;

export function createMemoryPersistence({
    store,
    sourceLedger,
    metadata,
    getMetadata,
    saveMetadata,
    logger,
    clock = Date,
    debounceMs = 250,
} = {}) {
    if (!store?.exportRecords || !store?.importRecords) throw new TypeError('Memory persistence requires a serializable store.');
    if (sourceLedger && (!sourceLedger.list || !sourceLedger.register || !sourceLedger.has)) {
        throw new TypeError('Memory persistence requires a serializable source ledger.');
    }
    const currentMetadata = createChatMetadataAccessor({ metadata, getMetadata }, 'Memory persistence');
    if (typeof saveMetadata !== 'function') throw new TypeError('Memory persistence requires saveMetadata().');

    let timer = null;
    let pending = null;
    let resolvePending = null;
    let rejectPending = null;
    let unsubscribe = null;
    let activeChatId = null;
    let activeMetadata = null;

    function container(metadata = activeMetadata ?? currentMetadata()) {
        metadata.nemolore ??= {};
        metadata.nemolore.memory ??= {};
        return metadata.nemolore.memory;
    }

    async function persist(chatId = activeChatId) {
        if (!chatId) return null;
        const target = container();
        const records = store.exportRecords();
        const referencedSourceIds = new Set(records.flatMap(record => record.sourceIds ?? []));
        target.schemaVersion = SCHEMA_VERSION;
        target.chatId = String(chatId);
        target.updatedAt = clock.now();
        target.records = records;
        target.sources = sourceLedger
            ? sourceLedger.list().filter(source => referencedSourceIds.has(source.id))
            : [];
        await saveMetadata();
        logger?.debug('Persisted NemoLore memory.', { chatId, count: target.records.length });
        return structuredClone(target);
    }

    async function runScheduled(chatId = activeChatId) {
        clearTimeout(timer);
        timer = null;
        try {
            const result = await persist(chatId);
            resolvePending?.(result);
            return result;
        } catch (error) {
            rejectPending?.(error);
            throw error;
        } finally {
            pending = null;
            resolvePending = null;
            rejectPending = null;
        }
    }

    function schedule(chatId = activeChatId) {
        if (!chatId) return Promise.resolve(null);
        if (!pending) {
            pending = new Promise((resolve, reject) => {
                resolvePending = resolve;
                rejectPending = reject;
            });
            // Detached store subscriptions must not produce an unhandled
            // rejection. The original promise still rejects for callers that
            // explicitly await schedule() or flush().
            void pending.catch(() => {});
        }
        clearTimeout(timer);
        timer = setTimeout(() => {
            void runScheduled(chatId).catch(error => {
                logger?.error('Scheduled NemoLore memory persistence failed.', error);
            });
        }, debounceMs);
        return pending;
    }

    function load(chatId) {
        activeChatId = chatId ? String(chatId) : null;
        activeMetadata = currentMetadata();
        const metadata = activeMetadata;
        const saved = metadata.nemolore?.memory;
        if (!saved || saved.chatId !== activeChatId || !Array.isArray(saved.records)) {
            store.clear({ silent: true });
            return [];
        }

        store.clear({ silent: true });
        if (sourceLedger) {
            for (const source of saved.sources ?? []) sourceLedger.register(source);

            // Schema v1 persisted source IDs on memories but not the source ledger itself.
            // Preserve those links with explicit recovery records so old chats remain loadable.
            for (const record of saved.records) {
                for (const sourceId of record.sourceIds ?? []) {
                    if (sourceLedger.has(sourceId)) continue;
                    const prefix = `${activeChatId}:`;
                    sourceLedger.register({
                        id: sourceId,
                        chatId: activeChatId,
                        messageId: String(sourceId).startsWith(prefix)
                            ? String(sourceId).slice(prefix.length)
                            : String(sourceId),
                        metadata: { recoveredFromMemorySchemaVersion: saved.schemaVersion ?? 1 },
                    });
                }
            }
        }
        return store.importRecords(saved.records, { replace: false, silent: true });
    }

    async function flush() {
        if (pending) return runScheduled();
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
        resolvePending?.(null);
        pending = null;
        resolvePending = null;
        rejectPending = null;
        activeMetadata = null;
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
