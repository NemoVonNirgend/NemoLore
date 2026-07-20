import {
    CONTEXT_POSITIONS,
    CONTEXT_ROLES,
    createContextContribution,
} from '../context-contribution.js';

<<<<<<< HEAD
export function createMemoryContextContributor({ retrieval, persistence, ownership, logger } = {}) {
=======
export function createMemoryContextContributor({ retrieval, persistence, settings, ownership, logger } = {}) {
>>>>>>> dev/preset-architecture
    if (!retrieval?.retrieve) throw new TypeError('Memory context contributor requires a retrieval service.');

    return Object.freeze({
        name: 'memory',

        async contribute(request = {}, options = {}) {
            if (ownership?.ownerFor?.('memory') === 'nemotavern') return [];
            if (persistence) {
                const requestChatId = request.chatId == null ? null : String(request.chatId);
<<<<<<< HEAD
                const persistedChatId = persistence.activeChatId == null
                    ? null
                    : String(persistence.activeChatId);
=======
                const persistedChatId = persistence.activeChatId == null ? null : String(persistence.activeChatId);
>>>>>>> dev/preset-architecture
                if (!requestChatId || requestChatId !== persistedChatId) {
                    logger?.debug('Skipped memory context for an inactive persistence chat.', {
                        requestChatId,
                        persistedChatId,
                    });
                    return [];
                }
            }
<<<<<<< HEAD

=======
>>>>>>> dev/preset-architecture
            const query = request.memoryQuery ?? {
                text: request.text ?? request.prompt ?? '',
                entityIds: request.entityIds ?? [],
                tags: request.tags ?? [],
                types: request.memoryTypes,
            };

            const result = await retrieval.retrieve(query, {
                maxTokens: options.memoryMaxTokens ?? request.memoryMaxTokens ?? settings?.memoryContextBudget ?? 1200,
                candidateLimit: options.memoryCandidateLimit ?? request.memoryCandidateLimit ?? settings?.memoryCandidateLimit ?? 16,
                minScore: options.memoryMinScore ?? request.memoryMinScore ?? 0.1,
                includeMetadata: options.includeMemoryMetadata ?? false,
                vectorSearchLimit: settings?.vectorSearchLimit,
                vectorSimilarityThreshold: settings?.vectorSimilarityThreshold,
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
