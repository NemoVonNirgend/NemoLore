import { MEMORY_TYPES } from './memory-types.js';

const MIGRATION_VERSION = 2;

function collectLegacySummaries(value) {
    if (!value) return [];
    if (typeof value === 'string') return [{ content: value }];
    if (Array.isArray(value)) return value.flatMap((item, index) => collectLegacySummaries(item)
        .map(summary => ({ messageIndex: summary.messageIndex ?? index, ...summary })));
    if (typeof value !== 'object') return [];

    if (typeof value.summary === 'string') return [{ ...value, content: value.summary }];
    if (typeof value.content === 'string') return [{ ...value, content: value.content }];
    if (typeof value.text === 'string') return [{ ...value, content: value.text }];

    return Object.entries(value).flatMap(([key, nested]) => collectLegacySummaries(nested).map(item => ({
        legacyKey: key,
        messageIndex: item.messageIndex ?? (/^\d+$/.test(key) ? Number(key) : undefined),
        ...item,
    })));
}

export function createLegacyMemoryMigrator({ store, sourceLedger, summaryStore, settings, metadata, saveMetadata, logger, clock = Date } = {}) {
    if (!store?.save) throw new TypeError('Legacy memory migrator requires a memory store.');

    async function migrate(chatId) {
        const normalizedChatId = String(chatId ?? '');
        if (!normalizedChatId) return { migrated: 0, skipped: true, reason: 'missing-chat-id' };

        metadata.nemolore ??= {};
        metadata.nemolore.migrations ??= {};
        const marker = metadata.nemolore.migrations.legacyChatSummaries;
        if (marker?.chatId === normalizedChatId && marker?.completedAt && Number(marker.version) >= MIGRATION_VERSION) {
            return { migrated: 0, skipped: true, reason: 'already-migrated' };
        }

        const legacyRoot = settings?.chatSummaries ?? {};
        const legacy = legacyRoot[normalizedChatId]
            ?? legacyRoot[String(normalizedChatId)]
            ?? metadata.chatSummaries
            ?? metadata.nemolore?.chatSummaries
            ?? null;
        const summaries = collectLegacySummaries(legacy)
            .map(item => ({ ...item, content: String(item.content ?? '').trim() }))
            .filter(item => item.content);

        let migrated = 0;
        let upgraded = 0;
        for (let index = 0; index < summaries.length; index += 1) {
            const item = summaries[index];
            const messageIndexes = [...new Set([
                item.messageIndex,
                ...(Array.isArray(item.pairedIndices) ? item.pairedIndices : []),
            ].filter(Number.isInteger))];
            const sourceIds = messageIndexes.map(messageIndex => sourceLedger?.register?.({
                chatId: normalizedChatId,
                messageId: String(messageIndex),
                messageIndex,
                metadata: { migratedLegacySummary: true },
            })?.id).filter(Boolean);
            const duplicate = store.query({
                status: null,
                predicate: record => record.metadata?.legacyMigration?.chatId === normalizedChatId
                    && record.metadata?.legacyMigration?.index === index,
            })[0];
            if (duplicate) {
                if (sourceIds.length && !duplicate.sourceIds.length) {
                    store.update(duplicate.id, { sourceIds });
                    upgraded += 1;
                }
                continue;
            }

            store.save({
                type: MEMORY_TYPES.CONSOLIDATED,
                title: item.title ?? `Legacy Summary ${index + 1}`,
                content: item.content,
                importance: 0.65,
                confidence: 0.8,
                tags: ['legacy-summary', 'migrated'],
                sourceIds,
                metadata: {
                    legacyMigration: {
                        source: 'chatSummaries',
                        chatId: normalizedChatId,
                        index,
                        legacyKey: item.legacyKey ?? null,
                    },
                },
                createdAt: item.createdAt ?? item.timestamp ?? undefined,
            });
            migrated += 1;
        }

        let summaryImported = false;
        if (summaries.length && summaryStore?.save && !summaryStore.get(normalizedChatId)) {
            await summaryStore.save(normalizedChatId, {
                text: summaries.map(item => item.content).join('\n\n'),
                sourceMessageIds: summaries.flatMap(item => [
                    item.messageIndex,
                    ...(Array.isArray(item.pairedIndices) ? item.pairedIndices : []),
                ]).filter(Number.isInteger).map(String),
                metadata: {
                    engine: 'modular',
                    importedFromLegacy: true,
                    importedSummaryCount: summaries.length,
                },
            });
            summaryImported = true;
        }

        metadata.nemolore.migrations.legacyChatSummaries = {
            version: MIGRATION_VERSION,
            chatId: normalizedChatId,
            completedAt: clock.now(),
            migrated,
            upgraded,
            summaryImported,
            sourcePreserved: true,
        };
        await saveMetadata?.();
        logger?.info('Migrated legacy NemoLore summaries.', { chatId: normalizedChatId, migrated, upgraded, summaryImported });
        return { migrated, upgraded, summaryImported, skipped: false };
    }

    return Object.freeze({ migrate, collectLegacySummaries });
}

export { collectLegacySummaries };
