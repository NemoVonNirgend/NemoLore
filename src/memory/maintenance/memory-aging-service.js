import { MEMORY_STATUS, MEMORY_TYPES, isLivingMemoryType } from '../memory-types.js';

const NEVER_AGE = new Set([MEMORY_TYPES.CORE]);

function latestMessageIndex(record, sourceLedger) {
    const indexes = sourceLedger.getForMemory(record.id)
        .map(source => source.messageIndex)
        .filter(Number.isInteger);
    return indexes.length ? Math.max(...indexes) : null;
}

export function createMemoryAgingService({ store, sourceLedger, settings, logger } = {}) {
    if (!store?.query || !store?.update) throw new TypeError('Memory aging requires a mutable memory store.');
    if (!sourceLedger?.getForMemory) throw new TypeError('Memory aging requires a source ledger.');

    function run({ messageCount } = {}) {
        if (!settings?.memoryAgingEnabled || !Number.isFinite(Number(messageCount))) {
            return { enabled: false, aged: [] };
        }

        const currentIndex = Math.max(0, Number(messageCount) - 1);
        const grace = Math.max(0, Number(settings.memoryAgingGraceMessages ?? 80));
        const rate = Math.max(0, Number(settings.memoryAgingRate ?? 0.08));
        const floor = Math.max(0, Math.min(1, Number(settings.memoryAgingFloor ?? 0.35)));
        const aged = [];

        for (const record of store.query({ status: MEMORY_STATUS.ACTIVE })) {
            if (NEVER_AGE.has(record.type) || isLivingMemoryType(record.type)) continue;
            const sourceIndex = latestMessageIndex(record, sourceLedger);
            if (sourceIndex == null) continue;
            const age = Math.max(0, currentIndex - sourceIndex);
            const intervals = Math.max(0, Math.floor((age - grace) / Math.max(1, grace)) + (age > grace ? 1 : 0));
            const retrievalMultiplier = Math.max(floor, 1 - (intervals * rate));
            const previous = Number(record.metadata?.aging?.retrievalMultiplier ?? 1);
            if (Math.abs(previous - retrievalMultiplier) < 0.0001) continue;

            store.update(record.id, {
                metadata: {
                    aging: {
                        version: 1,
                        sourceMessageIndex: sourceIndex,
                        evaluatedAtMessage: currentIndex,
                        ageMessages: age,
                        retrievalMultiplier,
                    },
                },
            });
            aged.push(record.id);
        }

        logger?.debug('Applied deterministic memory aging.', { currentIndex, aged: aged.length });
        return { enabled: true, aged };
    }

    return Object.freeze({ run });
}
