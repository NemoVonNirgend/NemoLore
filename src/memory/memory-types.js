export const MEMORY_TYPES = Object.freeze({
    EPISODE: 'episode',
    ATOMIC: 'atomic',
    ENTITY: 'entity',
    RELATIONSHIP: 'relationship',
    WORLD_STATE: 'world-state',
    CORE: 'core',
    CONSOLIDATED: 'consolidated',
});

export const MEMORY_STATUS = Object.freeze({
    ACTIVE: 'active',
    SUPERSEDED: 'superseded',
    INVALIDATED: 'invalidated',
    ARCHIVED: 'archived',
});

const VALID_TYPES = new Set(Object.values(MEMORY_TYPES));
const VALID_STATUSES = new Set(Object.values(MEMORY_STATUS));

export function assertMemoryType(type) {
    if (!VALID_TYPES.has(type)) {
        throw new TypeError(`Unknown memory type: ${type}`);
    }
    return type;
}

export function assertMemoryStatus(status) {
    if (!VALID_STATUSES.has(status)) {
        throw new TypeError(`Unknown memory status: ${status}`);
    }
    return status;
}

export function isLivingMemoryType(type) {
    return type === MEMORY_TYPES.ENTITY
        || type === MEMORY_TYPES.RELATIONSHIP
        || type === MEMORY_TYPES.WORLD_STATE;
}
