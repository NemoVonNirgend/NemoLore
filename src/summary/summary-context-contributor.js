import {
    CONTEXT_POSITIONS,
    CONTEXT_ROLES,
    createContextContribution,
} from '../context/context-contribution.js';

function extractLegacySummary(value) {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object') return '';
    return String(value.summary ?? value.text ?? value.content ?? '').trim();
}

export function createSummaryContextContributor({
    summaryStore,
    legacySummaries = {},
    settings = {},
    logger,
} = {}) {
    if (!summaryStore?.get) throw new TypeError('Summary context contributor requires a summary store.');

    function resolve(chatId) {
        const current = summaryStore.get(chatId);
        const legacyValue = legacySummaries?.[chatId];
        const legacyText = extractLegacySummary(legacyValue);
        const precedence = settings.summaryContextPrecedence ?? 'new-first';

        if (precedence === 'legacy-only') {
            return legacyText ? { text: legacyText, source: 'legacy', record: legacyValue } : null;
        }
        if (precedence === 'new-only') {
            return current?.text ? { text: current.text, source: 'new', record: current } : null;
        }
        if (precedence === 'legacy-first' && legacyText) {
            return { text: legacyText, source: 'legacy', record: legacyValue };
        }
        if (current?.text) return { text: current.text, source: 'new', record: current };
        return legacyText ? { text: legacyText, source: 'legacy', record: legacyValue } : null;
    }

    return Object.freeze({
        name: 'summary',
        resolve,

        async contribute(request = {}, options = {}) {
            if (settings.enableSummaryContext === false) return [];
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
                    precedence: settings.summaryContextPrecedence ?? 'new-first',
                },
            });
        },
    });
}
