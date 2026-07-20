import { createChatMetadataAccessor } from '../core/chat-metadata-accessor.js';
import { MEMORY_TYPES } from './memory-types.js';

export function getNemoTavernStringHash(value, seed = 0) {
    if (typeof value !== 'string') return 0;
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let index = 0, character; index < value.length; index += 1) {
        character = value.charCodeAt(index);
        h1 = Math.imul(h1 ^ character, 2654435761);
        h2 = Math.imul(h2 ^ character, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function nativeMessageId(message, index) {
    return String(message?.id
        ?? message?.extra?.messageId
        ?? message?.extra?.message_id
        ?? message?.send_date
        ?? `index-${index}`);
}

export function collectNativeNemoTavernMemory(chatId, chat = []) {
    if (!Array.isArray(chat)) return [];
    const summaries = [];
    const chunks = [];
    let uncovered = [];

    for (let index = 0; index < chat.length; index += 1) {
        const message = chat[index];
        const summary = typeof message?.extra?.nemo_summary === 'string'
            ? message.extra.nemo_summary.trim()
            : '';
        if (summary) {
            const item = { index, message, messageId: nativeMessageId(message, index), content: summary };
            summaries.push(item);
            uncovered.push(item);
        }

        const chunk = message?.extra?.nemo_chunk;
        const content = typeof chunk?.text === 'string' ? chunk.text.trim() : '';
        const count = Number(chunk?.count);
        if (!content || !Number.isInteger(count) || count <= 0) continue;
        const members = uncovered.slice(-count);
        const expectedHash = getNemoTavernStringHash(members.map(item => item.content).join('\n'));
        const valid = members.length === count
            && members.at(-1)?.index === index
            && (chunk.hash == null || String(chunk.hash) === String(expectedHash));
        if (!valid) continue;

        uncovered = uncovered.slice(0, -count);
        chunks.push({
            index: members[0].index,
            anchorIndex: index,
            message,
            messageId: nativeMessageId(message, index),
            content,
            count,
            hash: chunk.hash ?? expectedHash,
            memberMessageIds: members.map(item => item.messageId),
        });
    }

    const uncoveredIndexes = new Set(uncovered.map(item => item.index));
    return [
        ...summaries.filter(item => uncoveredIndexes.has(item.index)).map(item => ({ ...item, kind: 'message-summary' })),
        ...chunks.map(item => ({ ...item, kind: 'chapter-chunk' })),
    ].sort((left, right) => left.index - right.index).map(item => ({
        ...item,
        sourceId: `nemotavern:${chatId}:${item.kind}:${item.messageId}`,
    }));
}

export function createNemoTavernMemoryMigrator({
    store,
    sourceLedger,
    metadata,
    getMetadata,
    getChat,
    getActiveChatId,
    saveMetadata,
    logger,
    clock = Date,
} = {}) {
    if (!store?.save) throw new TypeError('NemoTavern memory migrator requires a memory store.');
    const currentMetadata = createChatMetadataAccessor({ metadata, getMetadata }, 'NemoTavern memory migrator');

    async function migrate(chatId) {
        const normalizedChatId = String(chatId ?? '');
        if (!normalizedChatId) return { migrated: 0, skipped: true, reason: 'missing-chat-id' };
        if (getActiveChatId && String(getActiveChatId() ?? '') !== normalizedChatId) {
            return { migrated: 0, skipped: true, reason: 'stale-chat' };
        }
        const targetMetadata = currentMetadata();
        targetMetadata.nemolore ??= {};
        targetMetadata.nemolore.migrations ??= {};
        const items = collectNativeNemoTavernMemory(normalizedChatId, getChat?.() ?? []);
        const previous = targetMetadata.nemolore.migrations.nativeNemoTavernMemory;
        let migrated = 0;
        let imported = 0;
        let updated = 0;
        let invalidated = 0;
        const currentSourceIds = new Set(items.map(item => item.sourceId));
        const existingNative = store.query({
            status: null,
            predicate: record => record.metadata?.nativeNemoTavern?.chatId === normalizedChatId,
        });

        for (const item of items) {
            const sourceHash = String(item.kind === 'chapter-chunk' ? item.hash : getNemoTavernStringHash(item.content));
            sourceLedger?.register({
                id: item.sourceId,
                chatId: normalizedChatId,
                messageId: item.messageId,
                messageIndex: item.kind === 'chapter-chunk' ? item.anchorIndex : item.index,
                role: item.message?.is_user ? 'user' : 'assistant',
                author: item.message?.name ?? null,
                hash: sourceHash,
                createdAt: item.message?.send_date ?? undefined,
                metadata: { source: 'nemotavern-memory', kind: item.kind },
            });
            const input = {
                type: MEMORY_TYPES.CONSOLIDATED,
                title: item.kind === 'chapter-chunk'
                    ? `NemoTavern Chapter Recap (${item.count} messages)`
                    : `NemoTavern Message Summary ${item.index + 1}`,
                content: item.content,
                sourceIds: sourceLedger ? [item.sourceId] : [],
                importance: item.kind === 'chapter-chunk' ? 0.75 : 0.6,
                confidence: 1,
                tags: ['nemotavern-memory', item.kind, 'migrated'],
                status: 'active',
                metadata: {
                    nativeNemoTavern: {
                        sourceId: item.sourceId,
                        source: 'message.extra',
                        kind: item.kind,
                        chatId: normalizedChatId,
                        messageId: item.messageId,
                        messageIndex: item.index,
                        anchorIndex: item.anchorIndex ?? item.index,
                        count: item.count ?? 1,
                        hash: sourceHash,
                        memberMessageIds: item.memberMessageIds ?? [item.messageId],
                        sourcePreserved: true,
                    },
                },
                createdAt: item.message?.send_date ?? undefined,
            };
            const duplicate = store.query({
                status: null,
                predicate: record => record.metadata?.nativeNemoTavern?.sourceId === item.sourceId,
            })[0];
            if (duplicate) {
                const unchanged = duplicate.content === item.content
                    && String(duplicate.metadata?.nativeNemoTavern?.hash) === sourceHash
                    && duplicate.status === 'active';
                if (unchanged) continue;
                store.update(duplicate.id, input);
                updated += 1;
                migrated += 1;
                continue;
            }
            store.save(input);
            imported += 1;
            migrated += 1;
        }

        for (const record of existingNative) {
            const sourceId = record.metadata.nativeNemoTavern.sourceId;
            if (currentSourceIds.has(sourceId) || record.status === 'invalidated') continue;
            store.invalidate(record.id, 'native-source-removed');
            invalidated += 1;
            migrated += 1;
        }

        const alreadyScanned = previous?.chatId === normalizedChatId
            && previous?.completedAt
            && previous.sourceIds?.length === items.length
            && items.every(item => previous.sourceIds?.includes(item.sourceId));
        if (alreadyScanned && migrated === 0) {
            return { migrated: 0, imported: 0, updated: 0, skipped: true, reason: 'already-migrated' };
        }
        targetMetadata.nemolore.migrations.nativeNemoTavernMemory = {
            chatId: normalizedChatId,
            completedAt: clock.now(),
            migrated: (previous?.chatId === normalizedChatId ? Number(previous.migrated) || 0 : 0) + migrated,
            sourceCount: items.length,
            sourceIds: items.map(item => item.sourceId),
            sourcePreserved: true,
        };
        await saveMetadata?.();
        logger?.info('Migrated native NemoTavern memory.', { chatId: normalizedChatId, migrated, imported, updated, invalidated });
        return {
            migrated,
            imported,
            updated,
            invalidated,
            skipped: false,
        };
    }

    return Object.freeze({ migrate, collectNativeNemoTavernMemory });
}
