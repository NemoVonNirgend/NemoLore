import {
    CONTEXT_POSITIONS,
    CONTEXT_ROLES,
    createContextContribution,
} from '../context-contribution.js';

export function createMemoryContextContributor({ retrieval, persistence, logger } = {}) {
    if (!retrieval?.retrieve) throw new TypeError('Memory context contributor requires a retrieval service.');

    return Object.freeze({
        name: 'memory',

        async contribute(request = {}, options = {}) {
            if (persistence) {
                const requestChatId = request.chatId == null ? null : String(request.chatId);
                const persistedChatId = persistence.activeChatId == null
                    ? null
                    : String(persistence.activeChatId);
                if (!requestChatId || requestChatId !== persistedChatId) {
                    logger?.debug('Skipped memory context for an inactive persistence chat.', {
                        requestChatId,
                        persistedChatId,
                    });
                    return [];
                }
            }

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

            if (!result.text?.trim()) return [];

            logger?.debug('Memory context contribution prepared.', {
                selected: result.selected?.length ?? 0,
                tokens: result.usedTokens ?? 0,
            });

            return createContextContribution({
                id: 'memory:retrieved',
                source: 'memory',
                title: 'Relevant Memory',
                content: result.text,
                role: CONTEXT_ROLES.SYSTEM,
                position: CONTEXT_POSITIONS.AFTER_SYSTEM,
                priority: options.priority ?? 70,
                estimatedTokens: result.usedTokens,
                metadata: {
                    selectedIds: result.memoryIds ?? [],
                    omitted: result.omitted ?? [],
                    groups: result.groups ?? {},
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
