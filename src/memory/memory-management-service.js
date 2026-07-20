import { MEMORY_STATUS, MEMORY_TYPES } from './memory-types.js';

function normalizeList(value) {
    if (Array.isArray(value)) return [...new Set(value.map(String).map(item => item.trim()).filter(Boolean))];
    return [...new Set(String(value ?? '').split(',').map(item => item.trim()).filter(Boolean))];
}

function matchesSearch(record, search) {
    if (!search) return true;
    const haystack = [
        record.id,
        record.title,
        record.content,
        record.type,
        record.status,
        ...(record.tags ?? []),
        ...(record.entityIds ?? []),
        ...(record.sourceIds ?? []),
    ].join('\n').toLowerCase();
    return haystack.includes(search.toLowerCase());
}

export function createMemoryManagementService({ store, logger } = {}) {
    if (!store?.list || !store?.update) throw new TypeError('Memory management requires a mutable memory store.');

    function list({ search = '', type = '', status = '', tag = '', entityId = '', reviewOnly = false } = {}) {
        return store.list()
            .filter(record => !type || record.type === type)
            .filter(record => !status || record.status === status)
            .filter(record => !tag || record.tags?.includes(tag))
            .filter(record => !entityId || record.entityIds?.includes(entityId))
            .filter(record => !reviewOnly || Boolean(record.metadata?.requiresReview || record.tags?.includes('contradiction')))
            .filter(record => matchesSearch(record, search))
            .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0)
                || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    }

    function edit(id, input = {}) {
        const existing = store.get(id);
        if (!existing) throw new Error(`Unknown memory: ${id}`);
        const patch = {
            title: input.title ?? existing.title,
            content: input.content ?? existing.content,
            tags: input.tags == null ? existing.tags : normalizeList(input.tags),
            entityIds: input.entityIds == null ? existing.entityIds : normalizeList(input.entityIds),
            importance: input.importance == null ? existing.importance : Math.max(0, Math.min(1, Number(input.importance))),
            confidence: input.confidence == null ? existing.confidence : Math.max(0, Math.min(1, Number(input.confidence))),
            metadata: {
                ...(existing.metadata ?? {}),
                ...(input.metadata ?? {}),
                managedAt: new Date().toISOString(),
                managedBy: 'memory-management',
            },
        };
        const result = store.update(id, patch);
        logger?.info('Edited memory record.', { id });
        return result;
    }

    function invalidate(id, reason = 'manual-invalidation') {
        return store.update(id, {
            status: MEMORY_STATUS.INVALIDATED,
            metadata: { invalidationReason: reason, manuallyInvalidated: true },
        });
    }

    function restore(id) {
        return store.update(id, {
            status: MEMORY_STATUS.ACTIVE,
            metadata: { invalidationReason: null, manuallyRestored: true },
        });
    }

    function archive(id) {
        return store.update(id, {
            status: MEMORY_STATUS.ARCHIVED,
            metadata: { manuallyArchived: true },
        });
    }

    function promoteToCore(id) {
        const existing = store.get(id);
        if (!existing) throw new Error(`Unknown memory: ${id}`);
        return store.update(id, {
            type: MEMORY_TYPES.CORE,
            status: MEMORY_STATUS.ACTIVE,
            importance: Math.max(0.9, existing.importance ?? 0),
            tags: [...new Set([...(existing.tags ?? []), 'core', 'promoted'])],
            metadata: { promotedFromType: existing.type, promotedAt: new Date().toISOString() },
        });
    }

    function markReviewed(id, resolution = 'accepted') {
        const existing = store.get(id);
        if (!existing) throw new Error(`Unknown memory: ${id}`);
        return store.update(id, {
            tags: (existing.tags ?? []).filter(tag => tag !== 'contradiction' && tag !== 'review-required'),
            metadata: {
                ...(existing.metadata ?? {}),
                requiresReview: false,
                reviewResolution: resolution,
                reviewedAt: new Date().toISOString(),
            },
        });
    }

    function facets() {
        const records = store.list();
        return Object.freeze({
            total: records.length,
            types: [...new Set(records.map(record => record.type))].sort(),
            statuses: [...new Set(records.map(record => record.status))].sort(),
            tags: [...new Set(records.flatMap(record => record.tags ?? []))].sort(),
            entities: [...new Set(records.flatMap(record => record.entityIds ?? []))].sort(),
        });
    }

    return Object.freeze({
        list,
        get: id => store.get(id),
        edit,
        invalidate,
        restore,
        archive,
        promoteToCore,
        markReviewed,
        facets,
        subscribe: listener => store.subscribe(listener),
    });
}
