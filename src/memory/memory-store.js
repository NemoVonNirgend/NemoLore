import { MEMORY_STATUS } from './memory-types.js';
import { createMemoryRecord, reviseMemoryRecord } from './memory-record.js';

export function createMemoryStore({ sourceLedger, logger, recordOptions } = {}) {
    const records = new Map();
    const indexes = {
        type: new Map(),
        entity: new Map(),
        tag: new Map(),
        status: new Map(),
    };

    function addToIndex(index, key, id) {
        if (!key) return;
        const bucket = index.get(key) ?? new Set();
        bucket.add(id);
        index.set(key, bucket);
    }

    function removeFromIndex(index, key, id) {
        const bucket = index.get(key);
        bucket?.delete(id);
        if (bucket?.size === 0) index.delete(key);
    }

    function indexRecord(record) {
        addToIndex(indexes.type, record.type, record.id);
        addToIndex(indexes.status, record.status, record.id);
        for (const entityId of record.entityIds) addToIndex(indexes.entity, entityId, record.id);
        for (const tag of record.tags) addToIndex(indexes.tag, tag, record.id);
    }

    function unindexRecord(record) {
        removeFromIndex(indexes.type, record.type, record.id);
        removeFromIndex(indexes.status, record.status, record.id);
        for (const entityId of record.entityIds) removeFromIndex(indexes.entity, entityId, record.id);
        for (const tag of record.tags) removeFromIndex(indexes.tag, tag, record.id);
    }

    function save(input) {
        const record = createMemoryRecord(input, recordOptions);
        if (records.has(record.id)) throw new Error(`Memory already exists: ${record.id}`);

        records.set(record.id, record);
        indexRecord(record);
        if (record.sourceIds.length) sourceLedger?.link(record.id, record.sourceIds);
        logger?.debug('Stored memory record.', { id: record.id, type: record.type });
        return record;
    }

    function update(id, patch) {
        const existing = records.get(id);
        if (!existing) throw new Error(`Unknown memory: ${id}`);

        const revised = reviseMemoryRecord(existing, patch, recordOptions);
        unindexRecord(existing);
        records.set(id, revised);
        indexRecord(revised);
        sourceLedger?.unlink(id);
        if (revised.sourceIds.length) sourceLedger?.link(id, revised.sourceIds);
        return revised;
    }

    function invalidate(id, reason = 'source-invalidated') {
        return update(id, {
            status: MEMORY_STATUS.INVALIDATED,
            metadata: { invalidationReason: reason },
        });
    }

    function remove(id) {
        const existing = records.get(id);
        if (!existing) return false;
        unindexRecord(existing);
        records.delete(id);
        sourceLedger?.unlink(id);
        return true;
    }

    function idsFromIndex(index, key) {
        return [...(index.get(key) ?? [])];
    }

    function query({ type, status = MEMORY_STATUS.ACTIVE, entityId, tag, predicate } = {}) {
        let candidateIds = null;
        const filters = [
            type ? idsFromIndex(indexes.type, type) : null,
            status ? idsFromIndex(indexes.status, status) : null,
            entityId ? idsFromIndex(indexes.entity, entityId) : null,
            tag ? idsFromIndex(indexes.tag, tag) : null,
        ].filter(Boolean);

        for (const ids of filters) {
            const set = new Set(ids);
            candidateIds = candidateIds == null
                ? set
                : new Set([...candidateIds].filter(id => set.has(id)));
        }

        const values = candidateIds == null
            ? [...records.values()]
            : [...candidateIds].map(id => records.get(id)).filter(Boolean);

        return predicate ? values.filter(predicate) : values;
    }

    return Object.freeze({
        save,
        update,
        invalidate,
        remove,
        query,
        get: id => records.get(id) ?? null,
        has: id => records.has(id),
        list: () => [...records.values()],
        clear() {
            records.clear();
            for (const index of Object.values(indexes)) index.clear();
            sourceLedger?.clear();
        },
        get size() { return records.size; },
    });
}
