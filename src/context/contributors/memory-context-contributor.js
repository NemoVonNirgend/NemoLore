import {
    CONTEXT_POSITIONS,
    CONTEXT_ROLES,
    createContextContribution,
} from '../context-contribution.js';

export function createMemoryContextContributor({ retrieval, logger } = {}) {
    if (!retrieval?.retrieve) throw new TypeError('Memory context contributor requires a retrieval service.');

    return Object.freeze({
        name: 'memory',

        async contribute(request = {}, options = {}) {
            const query = request.memoryQuery ?? {
                text: request.text ?? request.prompt ?? '',
                entityIds: request.entityIds ?? [],
                tags: request.tags ?? [],
                types: request.memoryTypes,
            };

            const result = retrieval.retrieve(query, {
                maxTokens: options.memoryMaxTokens ?? request.memoryMaxTokens ?? 1200,
                minScore: options.memoryMinScore ?? request.memoryMinScore ?? 0.1,
                includeMetadata: options.includeMemoryMetadata ?? false,
            });

            if (!result.context?.trim()) return [];

            logger?.debug('Memory context contribution prepared.', {
                selected: result.selected?.length ?? 0,
                tokens: result.estimatedTokens ?? 0,
            });

            return createContextContribution({
                id: 'memory:retrieved',
                source: 'memory',
                title: 'Relevant Memory',
                content: result.context,
                role: CONTEXT_ROLES.SYSTEM,
                position: CONTEXT_POSITIONS.AFTER_SYSTEM,
                priority: options.priority ?? 70,
                estimatedTokens: result.estimatedTokens,
                metadata: {
                    selectedIds: result.selected?.map(item => item.record?.id ?? item.id) ?? [],
                    omitted: result.omitted ?? [],
                    scores: result.selected?.map(item => ({
                        id: item.record?.id ?? item.id,
                        score: item.score,
                        components: item.components,
                    })) ?? [],
                },
            });
        },
    });
}
