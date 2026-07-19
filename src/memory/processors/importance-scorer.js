import { MEMORY_TYPES } from '../memory-types.js';

const TYPE_BASELINE = Object.freeze({
    [MEMORY_TYPES.CORE]: 1,
    [MEMORY_TYPES.RELATIONSHIP]: 0.72,
    [MEMORY_TYPES.WORLD_STATE]: 0.68,
    [MEMORY_TYPES.ENTITY]: 0.64,
    [MEMORY_TYPES.ATOMIC]: 0.58,
    [MEMORY_TYPES.EPISODE]: 0.52,
    [MEMORY_TYPES.CONSOLIDATED]: 0.5,
});

const HIGH_SIGNAL_TAGS = new Set([
    'promise',
    'secret',
    'death',
    'betrayal',
    'revelation',
    'relationship',
    'injury',
    'goal',
    'unresolved',
    'core',
]);

function clamp(value) {
    return Math.min(1, Math.max(0, Number(value) || 0));
}

export function createImportanceScorer({ logger } = {}) {
    return async function scoreImportance(candidate) {
        const modelScore = clamp(candidate.importance ?? 0.5);
        const baseline = TYPE_BASELINE[candidate.type] ?? 0.5;
        const tags = new Set((candidate.tags ?? []).map(tag => String(tag).toLowerCase()));
        const data = candidate.data ?? {};

        let bonus = 0;
        if ([...tags].some(tag => HIGH_SIGNAL_TAGS.has(tag))) bonus += 0.08;
        if (Array.isArray(data.unresolvedThreads) && data.unresolvedThreads.length) bonus += 0.08;
        if (data.predicate && /promise|swear|discover|learn|reveal|betray/i.test(data.predicate)) bonus += 0.07;
        if (data.field && /trust|affection|loyalty|injury|status|goal|location/i.test(data.field)) bonus += 0.05;
        if ((candidate.entityIds ?? candidate.entities ?? []).length > 1) bonus += 0.03;
        if (candidate.confidence != null && Number(candidate.confidence) < 0.5) bonus -= 0.1;

        const scored = clamp((modelScore * 0.55) + (baseline * 0.45) + bonus);
        logger?.debug('Scored memory importance.', {
            type: candidate.type,
            modelScore,
            scored,
        });

        return {
            ...candidate,
            entityIds: candidate.entityIds ?? candidate.entities ?? [],
            importance: scored,
            metadata: {
                ...(candidate.metadata ?? {}),
                importanceScoring: {
                    modelScore,
                    baseline,
                    bonus,
                    version: 1,
                },
            },
        };
    };
}
