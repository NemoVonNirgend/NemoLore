import { createChatMetadataAccessor } from '../core/chat-metadata-accessor.js';
import { MEMORY_TYPES } from './memory-types.js';
import { createNemoTavernMemoryMigrator } from './nemotavern-memory-migrator.js';

function collectLegacySummaries(value) {
    if (!value) return [];
    if (typeof value === 'string') return [{ content: value }];
    if (Array.isArray(value)) return value.flatMap(collectLegacySummaries);
    if (typeof value !== 'object') return [];

    if (typeof value.summary === 'string') return [{ ...value, content: value.summary }];
    if (typeof value.content === 'string') return [{ ...value, content: value.content }];
    if (typeof value.text === 'string') return [{ ...value, content: value.text }];

    return Object.entries(value).flatMap(([key, nested]) => collectLegacySummaries(nested).map(item => ({ legacyKey: key, ...item })));
}

export function createLegacyMemoryMigrator({
    store,
    sourceLedger,
    settings,
    metadata,
    getMetadata,
    getChat,
    getActiveChatId,
    saveMetadata,
    logger,
    clock = Date,
} = {}) {
    if (!store?.save) throw new TypeError('Legacy memory migrator requires a memory store.');
    const currentMetadata = createChatMetadataAccessor({ metadata, getMetadata }, 'Legacy memory migrator');
    const nativeMigrator = createNemoTavernMemoryMigrator({
        store, sourceLedger, metadata, getMetadata, getChat, getActiveChatId, saveMetadata, logger, clock,
    });

    async function migrate(chatId) {
        const normalizedChatId = String(chatId ?? '');
        if (!normalizedChatId) return { migrated: 0, skipped: true, reason: 'missing-chat-id' };
        if (getActiveChatId && String(getActiveChatId() ?? '') !== normalizedChatId) {
            return { migrated: 0, skipped: true, reason: 'stale-chat' };
        }
        const native = await nativeMigrator.migrate(normalizedChatId);
        if (getActiveChatId && String(getActiveChatId() ?? '') !== normalizedChatId) {
            return { migrated: native.migrated, skipped: true, reason: 'stale-chat', sources: { native } };
        }

        const metadata = currentMetadata();
        metadata.nemolore ??= {};
        metadata.nemolore.migrations ??= {};
        const marker = metadata.nemolore.migrations.legacyChatSummaries;
        if (marker?.chatId === normalizedChatId && marker?.completedAt) {
            return {
                migrated: native.migrated,
                skipped: native.skipped,
                ...(native.skipped ? { reason: 'already-migrated' } : {}),
                sources: { native, legacy: { migrated: 0, skipped: true } },
            };
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
        for (let index = 0; index < summaries.length; index += 1) {
            const item = summaries[index];
            const duplicate = store.query({
                status: null,
                predicate: record => record.metadata?.legacyMigration?.chatId === normalizedChatId
                    && record.metadata?.legacyMigration?.index === index,
            })[0];
            if (duplicate) continue;

            store.save({
                type: MEMORY_TYPES.CONSOLIDATED,
                title: item.title ?? `Legacy Summary ${index + 1}`,
                content: item.content,
                importance: 0.65,
                confidence: 0.8,
                tags: ['legacy-summary', 'migrated'],
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

        metadata.nemolore.migrations.legacyChatSummaries = {
            chatId: normalizedChatId,
            completedAt: clock.now(),
            migrated,
            sourcePreserved: true,
        };
        await saveMetadata?.();
        logger?.info('Migrated legacy NemoLore summaries.', { chatId: normalizedChatId, migrated });
        return {
            migrated: migrated + native.migrated,
            skipped: false,
            sources: { native, legacy: { migrated, skipped: false } },
        };
    }

    return Object.freeze({ migrate, collectLegacySummaries, native: nativeMigrator });
}

export { collectLegacySummaries };
