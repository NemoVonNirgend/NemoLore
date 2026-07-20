import { MEMORY_STATUS, MEMORY_TYPES, isLivingMemoryType } from '../memory-types.js';

const ELIGIBLE_TYPES = new Set([MEMORY_TYPES.ATOMIC, MEMORY_TYPES.EPISODE, MEMORY_TYPES.CONSOLIDATED]);

export function createCorePromotionService({ store, settings, logger } = {}) {
    if (!store?.query || !store?.update) throw new TypeError('Core promotion requires a mutable memory store.');

    function run({ messageCount } = {}) {
        const currentCount = Number(messageCount ?? 0);
        if (!settings?.enableCoreMemories || currentCount < Number(settings.coreMemoryStartCount ?? 20)) {
            return { enabled: false, promoted: [] };
        }
        const importanceThreshold = Math.max(0, Math.min(1, Number(settings.coreMemoryImportanceThreshold ?? 0.9)));
        const limit = Math.max(1, Number(settings.coreMemoryMaxPromotionsPerRun ?? 1));
        const candidates = store.query({ status: MEMORY_STATUS.ACTIVE })
            .filter(record => ELIGIBLE_TYPES.has(record.type) && !isLivingMemoryType(record.type))
            .filter(record => record.importance >= importanceThreshold && !record.metadata?.corePromotion)
            .sort((left, right) => right.importance - left.importance
                || right.confidence - left.confidence
                || left.createdAt.localeCompare(right.createdAt)
                || left.id.localeCompare(right.id))
            .slice(0, limit);
        const promoted = [];
        for (const record of candidates) {
            store.update(record.id, {
                type: MEMORY_TYPES.CORE,
                importance: Math.max(0.9, record.importance),
                tags: [...new Set([...record.tags, 'core', 'promoted'])],
                metadata: {
                    corePromotion: {
                        version: 1,
                        originalType: record.type,
                        originalImportance: record.importance,
                        originalTags: [...record.tags],
                        promotedAtMessage: currentCount,
                    },
                },
            });
            promoted.push(record.id);
        }
        logger?.debug('Promoted high-importance memories to core.', { promoted: promoted.length, currentCount, importanceThreshold });
        return { enabled: true, promoted };
    }

    function restore(id) {
        const record = store.get(id);
        const promotion = record?.metadata?.corePromotion;
        if (record?.type !== MEMORY_TYPES.CORE || !promotion?.originalType) return false;
        store.update(id, {
            type: promotion.originalType,
            importance: promotion.originalImportance,
            tags: promotion.originalTags ?? record.tags.filter(tag => tag !== 'core' && tag !== 'promoted'),
            metadata: { corePromotion: null, corePromotionRestored: true },
        });
        return true;
    }

    return Object.freeze({ run, restore });
}
