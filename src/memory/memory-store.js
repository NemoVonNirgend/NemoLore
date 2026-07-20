import { MEMORY_STATUS } from './memory-types.js';
import { createMemoryRecord, reviseMemoryRecord } from './memory-record.js';

export function createMemoryStore({ sourceLedger, logger, recordOptions } = {}) {
    const records = new Map();
    const listeners = new Set();
    const indexes = {
        type: new Map(),
        entity: new Map(),
        tag: new Map(),
        status: new Map(),
    };

    function emit(event, record = null) {
        const snapshot = record ? structuredClone(record) : null;
        for (const listener of listeners) {
            try { listener(event, snapshot); } catch (error) { logger?.error('Memory store listener failed.', error); }
        }
    }

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

    function save(input, { silent = false } = {}) {
        const record = createMemoryRecord(input, recordOptions);
        if (records.has(record.id)) throw new Error(`Memory already exists: ${record.id}`);

        records.set(record.id, record);
        indexRecord(record);
        if (record.sourceIds.length) sourceLedger?.link(record.id, record.sourceIds);
        logger?.debug('Stored memory record.', { id: record.id, type: record.type });
        if (!silent) emit('saved', record);
        return record;
    }

    function update(id, patch, { silent = false } = {}) {
        const existing = records.get(id);
        if (!existing) throw new Error(`Unknown memory: ${id}`);

        const revised = reviseMemoryRecord(existing, patch, recordOptions);
        unindexRecord(existing);
        records.set(id, revised);
        indexRecord(revised);
        sourceLedger?.unlink(id);
        if (revised.sourceIds.length) sourceLedger?.link(id, revised.sourceIds);
        if (!silent) emit('updated', revised);
        return revised;
    }

    function invalidate(id, reason = 'source-invalidated') {
        return update(id, {
            status: MEMORY_STATUS.INVALIDATED,
            metadata: { invalidationReason: reason },
        });
    }

    function remove(id, { silent = false } = {}) {
        const existing = records.get(id);
        if (!existing) return false;
        unindexRecord(existing);
        records.delete(id);
        sourceLedger?.unlink(id);
        if (!silent) emit('removed', existing);
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

    function clear({ silent = false } = {}) {
        records.clear();
        for (const index of Object.values(indexes)) index.clear();
        sourceLedger?.clear();
        if (!silent) emit('cleared');
    }

    function exportRecords() {
        return structuredClone([...records.values()]);
    }

    function importRecords(input = [], { replace = true, silent = false } = {}) {
        if (!Array.isArray(input)) throw new TypeError('Memory import requires an array.');
        if (replace) clear({ silent: true });
        const imported = [];
        for (const record of input) {
            if (records.has(record.id)) continue;
            imported.push(save(record, { silent: true }));
        }
        if (!silent) emit('imported');
        return imported;
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') throw new TypeError('Memory listener must be a function.');
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    return Object.freeze({
        save,
        update,
        invalidate,
        remove,
        query,
        clear,
        exportRecords,
        importRecords,
        subscribe,
        get: id => records.get(id) ?? null,
        has: id => records.has(id),
        list: () => [...records.values()],
        get size() { return records.size; },
    });
}
