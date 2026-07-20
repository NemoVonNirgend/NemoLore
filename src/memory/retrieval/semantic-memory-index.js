import { MEMORY_STATUS } from '../memory-types.js';

function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function collectionId(chatId) {
    return `nemolore_${hashString(String(chatId)).toString(36)}`;
}

function recordText(record) {
    return [record.title, record.content, ...record.entityIds, ...record.tags].filter(Boolean).join('\n');
}

function similarityFrom(result, index) {
    const metadata = result.metadata?.[index] ?? {};
    const value = metadata.score ?? metadata.similarity ?? result.scores?.[index] ?? result.similarities?.[index];
    return Number.isFinite(Number(value)) ? Number(value) : 1;
}

export function createSemanticMemoryIndex({ store, adapter, settings, logger } = {}) {
    if (!store?.list || !store?.subscribe) throw new TypeError('Semantic memory index requires a memory store.');
    if (!adapter?.list || !adapter?.insert || !adapter?.remove || !adapter?.query) throw new TypeError('Semantic memory index requires a vector adapter.');
    let activeChatId = null;
    let unsubscribe = null;
    let queue = Promise.resolve();
    const dirtyHashes = new Set();
    const state = {
        indexedCount: 0,
        syncing: false,
        lastSyncAt: null,
        lastQueryAt: null,
        lastError: null,
    };

    function hashFor(record) {
        return hashString(`memory:${record.id}`);
    }

    function recordsByHash() {
        return new Map(store.list().map(record => [hashFor(record), record]));
    }

    function enabled() {
        return Boolean(settings?.enableVectorization && activeChatId && adapter.available?.() !== false);
    }

    async function synchronize({ rebuild = false } = {}) {
        if (!enabled()) return { enabled: false, inserted: 0, removed: 0 };
        state.syncing = true;
        const id = collectionId(activeChatId);
        try {
            const active = store.list().filter(record => record.status === MEMORY_STATUS.ACTIVE);
            const wanted = new Map(active.map(record => [hashFor(record), record]));
            const saved = new Set((await adapter.list(id)).map(Number));
            const stale = rebuild ? [...saved] : [...saved].filter(hash => !wanted.has(hash) || dirtyHashes.has(hash));
            const missing = rebuild ? [...wanted] : [...wanted].filter(([hash]) => !saved.has(hash) || dirtyHashes.has(hash));
            if (stale.length) await adapter.remove(id, stale);
            if (missing.length) await adapter.insert(id, missing.map(([hash, record], index) => ({
                hash,
                text: recordText(record),
                index,
            })));
            for (const hash of [...stale, ...missing.map(([hash]) => hash)]) dirtyHashes.delete(hash);
            state.indexedCount = wanted.size;
            state.lastSyncAt = new Date().toISOString();
            state.lastError = null;
            logger?.debug('Synchronized semantic memory collection.', { chatId: activeChatId, inserted: missing.length, removed: stale.length, rebuild });
            return { enabled: true, inserted: missing.length, removed: stale.length, indexed: wanted.size, rebuild };
        } finally {
            state.syncing = false;
        }
    }

    function scheduleSync() {
        queue = queue.then(synchronize).catch(error => {
            state.lastError = error.message;
            logger?.warn('Semantic memory synchronization failed; lexical retrieval remains active.', { error });
            return { enabled: false, error };
        });
        return queue;
    }

    async function activate(chatId) {
        activeChatId = chatId ? String(chatId) : null;
        state.indexedCount = 0;
        state.lastError = null;
        return scheduleSync();
    }

    function rebuild() {
        queue = queue.then(() => synchronize({ rebuild: true })).catch(error => {
            state.lastError = error.message;
            logger?.warn('Semantic memory rebuild failed; lexical retrieval remains active.', { error });
            return { enabled: false, error };
        });
        return queue;
    }

    async function query(text, { topK, threshold } = {}) {
        if (!enabled() || !String(text ?? '').trim()) return new Map();
        await queue;
        try {
            const result = await adapter.query(collectionId(activeChatId), String(text), { topK, threshold });
            state.lastQueryAt = new Date().toISOString();
            state.lastError = null;
            const byHash = recordsByHash();
            return new Map((result.hashes ?? []).map((hash, index) => {
                const record = byHash.get(Number(hash));
                return record ? [record.id, similarityFrom(result, index)] : null;
            }).filter(Boolean));
        } catch (error) {
            state.lastError = error.message;
            logger?.warn('Semantic memory query failed; using lexical retrieval.', { error });
            return new Map();
        }
    }

    function start() {
        if (unsubscribe) return false;
        unsubscribe = store.subscribe((event, record) => {
            if (record?.id && (event === 'saved' || event === 'updated')) dirtyHashes.add(hashFor(record));
            if (enabled()) scheduleSync();
        });
        return true;
    }

    function stop() {
        unsubscribe?.();
        unsubscribe = null;
    }

    function inspect() {
        const adapterState = adapter.inspect?.() ?? { available: adapter.available?.() !== false };
        return Object.freeze({
            enabled: Boolean(settings?.enableVectorization),
            available: Boolean(adapterState.available),
            source: adapterState.source ?? null,
            model: adapterState.model ?? null,
            unavailableReason: adapterState.reason ?? null,
            activeChatId,
            collectionId: activeChatId ? collectionId(activeChatId) : null,
            activeMemoryCount: store.list().filter(record => record.status === MEMORY_STATUS.ACTIVE).length,
            dirtyCount: dirtyHashes.size,
            ...state,
        });
    }

    return Object.freeze({ activate, synchronize, scheduleSync, rebuild, query, inspect, start, stop, hashFor, get activeChatId() { return activeChatId; } });
}
