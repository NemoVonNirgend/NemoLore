import {
    MEMORY_STATUS,
    assertMemoryStatus,
    assertMemoryType,
} from './memory-types.js';

function defaultIdFactory() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `memory-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeStringArray(values = []) {
    return [...new Set(values
        .filter(value => typeof value === 'string')
        .map(value => value.trim())
        .filter(Boolean))];
}

function cloneData(value) {
    return value == null ? value : structuredClone(value);
}

export function createMemoryRecord(input, {
    idFactory = defaultIdFactory,
    now = () => new Date().toISOString(),
} = {}) {
    if (!input || typeof input !== 'object') {
        throw new TypeError('Memory input must be an object.');
    }

    const type = assertMemoryType(input.type);
    const status = assertMemoryStatus(input.status ?? MEMORY_STATUS.ACTIVE);
    const timestamp = input.createdAt ?? now();
    const content = typeof input.content === 'string' ? input.content.trim() : '';

    if (!content && input.data == null) {
        throw new TypeError('Memory requires content or structured data.');
    }

    const record = {
        id: input.id ?? idFactory(),
        type,
        status,
        revision: Number.isInteger(input.revision) && input.revision > 0 ? input.revision : 1,
        title: typeof input.title === 'string' ? input.title.trim() : '',
        content,
        data: cloneData(input.data ?? null),
        sourceIds: normalizeStringArray(input.sourceIds),
        entityIds: normalizeStringArray(input.entityIds),
        tags: normalizeStringArray(input.tags),
        importance: Math.min(1, Math.max(0, Number(input.importance ?? 0.5))),
        confidence: Math.min(1, Math.max(0, Number(input.confidence ?? 1))),
        createdAt: timestamp,
        updatedAt: input.updatedAt ?? timestamp,
        supersedes: input.supersedes ?? null,
        supersededBy: input.supersededBy ?? null,
        metadata: cloneData(input.metadata ?? {}),
    };

    return Object.freeze(record);
}

export function reviseMemoryRecord(existing, patch, options = {}) {
    if (!existing?.id) throw new TypeError('Existing memory record is required.');

    return createMemoryRecord({
        ...existing,
        ...patch,
        id: existing.id,
        revision: existing.revision + 1,
        createdAt: existing.createdAt,
        updatedAt: options.now?.() ?? new Date().toISOString(),
        sourceIds: patch.sourceIds ?? existing.sourceIds,
        entityIds: patch.entityIds ?? existing.entityIds,
        tags: patch.tags ?? existing.tags,
        metadata: {
            ...existing.metadata,
            ...(patch.metadata ?? {}),
        },
    }, options);
}
