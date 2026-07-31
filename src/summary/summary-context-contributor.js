import {
    CONTEXT_POSITIONS,
    CONTEXT_ROLES,
    createContextContribution,
} from '../context/context-contribution.js';

export function createSummaryContextContributor({
    summaryStore,
    settings = {},
    ownership,
    logger,
} = {}) {
    if (!summaryStore?.get) throw new TypeError('Summary context contributor requires a summary store.');

    function resolve(chatId) {
        const current = summaryStore.get(chatId);
        return current?.text ? { text: current.text, source: 'modular', record: current } : null;
    }

    return Object.freeze({
        name: 'summary',
        resolve,

        async contribute(request = {}, options = {}) {
            if (settings.enableSummaryContext === false) return [];
            const owner = ownership?.ownerFor?.('summary');
            if (owner !== undefined && owner !== 'nemolore-modular') return [];
            const chatId = request.chatId ?? request.context?.chatId;
            if (!chatId) return [];
            const resolved = resolve(String(chatId));
            if (!resolved?.text) return [];

            logger?.debug('Summary context contribution prepared.', {
                chatId,
                source: resolved.source,
            });

            return createContextContribution({
                id: `summary:${chatId}`,
                source: 'summary',
                title: 'Conversation Summary',
                content: `## Conversation Summary\n\n${resolved.text}`,
                role: CONTEXT_ROLES.SYSTEM,
                position: CONTEXT_POSITIONS.AFTER_SYSTEM,
                priority: options.priority ?? settings.summaryContextPriority ?? 80,
                estimatedTokens: Math.ceil(resolved.text.length / 4) + 8,
                metadata: {
                    summarySource: resolved.source,
                    summaryUpdatedAt: resolved.record?.updatedAt ?? null,
                    sourceMessageIds: resolved.record?.sourceMessageIds ?? [],
                    precedence: 'modular-only',
                },
            });
        },
    });
}
