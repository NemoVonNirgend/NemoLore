import {
    CONTEXT_POSITIONS,
    CONTEXT_ROLES,
    createContextContribution,
} from '../context/context-contribution.js';

export function createSummaryContextContributor({
    summaryStore,
<<<<<<< HEAD
    legacySummaries = {},
    getMetadata,
=======
>>>>>>> dev/preset-architecture
    settings = {},
    ownership,
    logger,
} = {}) {
    if (!summaryStore?.get) throw new TypeError('Summary context contributor requires a summary store.');

    function resolve(chatId) {
        const current = summaryStore.get(chatId);
<<<<<<< HEAD
        const nativeValue = getMetadata?.()?.nemolore?.summary;
        const configuredValue = legacySummaries?.[chatId];
        const nativeText = extractLegacySummary(nativeValue);
        const configuredText = extractLegacySummary(configuredValue);
        const legacy = nativeText
            ? { text: nativeText, record: nativeValue, legacySource: 'nemotavern' }
            : configuredText
                ? { text: configuredText, record: configuredValue, legacySource: 'chatSummaries' }
                : null;
        const precedence = settings.summaryContextPrecedence ?? 'new-first';

        if (precedence === 'legacy-only') {
            return legacy ? { ...legacy, source: 'legacy' } : null;
        }
        if (precedence === 'new-only') {
            return current?.text ? { text: current.text, source: 'new', record: current } : null;
        }
        if (precedence === 'legacy-first' && legacy) {
            return { ...legacy, source: 'legacy' };
        }
        if (current?.text) return { text: current.text, source: 'new', record: current };
        return legacy ? { ...legacy, source: 'legacy' } : null;
=======
        return current?.text ? { text: current.text, source: 'modular', record: current } : null;
>>>>>>> dev/preset-architecture
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
<<<<<<< HEAD
                    precedence: settings.summaryContextPrecedence ?? 'new-first',
                    legacySummarySource: resolved.legacySource ?? null,
=======
                    precedence: 'modular-only',
>>>>>>> dev/preset-architecture
                },
            });
        },
    });
}
