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

    function hashFor(record) {
        return hashString(`memory:${record.id}`);
    }

    function recordsByHash() {
        return new Map(store.list().map(record => [hashFor(record), record]));
    }

    function enabled() {
        return Boolean(settings?.enableVectorization && activeChatId && adapter.available?.() !== false);
    }

    async function synchronize() {
        if (!enabled()) return { enabled: false, inserted: 0, removed: 0 };
        const id = collectionId(activeChatId);
        const active = store.list().filter(record => record.status === MEMORY_STATUS.ACTIVE);
        const wanted = new Map(active.map(record => [hashFor(record), record]));
        const saved = new Set((await adapter.list(id)).map(Number));
        const stale = [...saved].filter(hash => !wanted.has(hash) || dirtyHashes.has(hash));
        const missing = [...wanted].filter(([hash]) => !saved.has(hash) || dirtyHashes.has(hash));
        if (stale.length) await adapter.remove(id, stale);
        if (missing.length) await adapter.insert(id, missing.map(([hash, record], index) => ({
            hash,
            text: recordText(record),
            index,
        })));
        for (const hash of [...stale, ...missing.map(([hash]) => hash)]) dirtyHashes.delete(hash);
        logger?.debug('Synchronized semantic memory collection.', { chatId: activeChatId, inserted: missing.length, removed: stale.length });
        return { enabled: true, inserted: missing.length, removed: stale.length };
    }

    function scheduleSync() {
        queue = queue.then(synchronize).catch(error => {
            logger?.warn('Semantic memory synchronization failed; lexical retrieval remains active.', { error });
            return { enabled: false, error };
        });
        return queue;
    }

    async function activate(chatId) {
        activeChatId = chatId ? String(chatId) : null;
        return scheduleSync();
    }

    async function query(text, { topK, threshold } = {}) {
        if (!enabled() || !String(text ?? '').trim()) return new Map();
        await queue;
        try {
            const result = await adapter.query(collectionId(activeChatId), String(text), { topK, threshold });
            const byHash = recordsByHash();
            return new Map((result.hashes ?? []).map((hash, index) => {
                const record = byHash.get(Number(hash));
                return record ? [record.id, similarityFrom(result, index)] : null;
            }).filter(Boolean));
        } catch (error) {
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

    return Object.freeze({ activate, synchronize, scheduleSync, query, start, stop, hashFor, get activeChatId() { return activeChatId; } });
}
