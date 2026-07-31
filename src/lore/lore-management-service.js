import { assertActiveChat, createActiveChatGuard } from '../core/active-chat-guard.js';

function entriesFrom(book) {
    return Object.values(book?.entries ?? book ?? {}).filter(value => value && typeof value === 'object');
}

function text(value) {
    return Array.isArray(value) ? value.join(' ') : String(value ?? '');
}

export function createLoreManagementService({ lorebooks, generation, entityIndex, getChatId, logger } = {}) {
    if (!lorebooks?.load) throw new TypeError('Lore management requires lorebook repository.');

    function captureTarget(chatId) {
        const expectedChatId = chatId ?? getChatId?.();
        assertActiveChat(getChatId, expectedChatId);
        return {
            chatId: expectedChatId,
            lorebookName: lorebooks.getAssociatedName?.() ?? null,
            shouldCommit: createActiveChatGuard(getChatId, expectedChatId),
        };
    }

    async function list({ search = '', protectedOnly = false, chatId } = {}) {
        const expectedChatId = chatId ?? getChatId?.();
        if (typeof getChatId === 'function' && expectedChatId == null) return [];
        const target = captureTarget(expectedChatId);
        if (typeof lorebooks.getAssociatedName === 'function' && !target.lorebookName) return [];
        const book = await lorebooks.load(target.lorebookName || undefined);
        assertActiveChat(getChatId, target.chatId);
        const query = search.trim().toLowerCase();
        return entriesFrom(book)
            .filter(entry => !protectedOnly || entry.extensions?.nemolore?.protected)
            .filter(entry => !query || [entry.comment, entry.content, text(entry.key)]
                .join(' ')
                .toLowerCase()
                .includes(query))
            .map(entry => ({
                ...structuredClone(entry),
                normalizedIdentities: entityIndex.identitiesFor(entry),
                protected: Boolean(entry.extensions?.nemolore?.protected),
            }));
    }

    async function protect(uid, protectedValue = true, { chatId } = {}) {
        const target = captureTarget(chatId);
        const book = await lorebooks.load(target.lorebookName || undefined);
        assertActiveChat(getChatId, target.chatId);
        const entry = entriesFrom(book).find(item => String(item.uid) === String(uid));
        if (!entry) throw new Error(`Unknown lore entry: ${uid}`);
        const updated = await lorebooks.updateEntry(uid, {
            extensions: {
                ...(entry.extensions ?? {}),
                nemolore: {
                    ...(entry.extensions?.nemolore ?? {}),
                    protected: Boolean(protectedValue),
                    protectedAt: new Date().toISOString(),
                },
            },
        }, target.lorebookName || undefined, { shouldCommit: target.shouldCommit });
        assertActiveChat(getChatId, target.chatId);
        return updated;
    }

    async function merge(primaryUid, duplicateUids = [], { chatId } = {}) {
        const target = captureTarget(chatId);
        const book = await lorebooks.load(target.lorebookName || undefined);
        assertActiveChat(getChatId, target.chatId);
        const all = entriesFrom(book);
        const primary = all.find(entry => String(entry.uid) === String(primaryUid));
        if (!primary) throw new Error(`Unknown primary lore entry: ${primaryUid}`);
        const primaryId = String(primaryUid);
        const duplicateIds = [...new Set(duplicateUids.map(String))].filter(uid => uid !== primaryId);
        const duplicates = all.filter(entry => duplicateIds.includes(String(entry.uid)));
        const resolvedDuplicateIds = duplicates.map(entry => String(entry.uid));
        const mergedContent = [primary.content, ...duplicates.map(entry => entry.content)]
            .map(value => String(value ?? '').trim())
            .filter(Boolean)
            .filter((value, index, values) => values.indexOf(value) === index)
            .join('\n\n');
        const mergedKeys = [...new Set([
            ...(Array.isArray(primary.key) ? primary.key : [primary.key]),
            ...duplicates.flatMap(entry => Array.isArray(entry.key) ? entry.key : [entry.key]),
        ].filter(Boolean).map(String))];
        const updated = await lorebooks.updateEntry(primaryUid, {
            content: mergedContent,
            key: mergedKeys,
            extensions: {
                ...(primary.extensions ?? {}),
                nemolore: {
                    ...(primary.extensions?.nemolore ?? {}),
                    mergedFrom: resolvedDuplicateIds,
                    mergedAt: new Date().toISOString(),
                },
            },
        }, target.lorebookName || undefined, { shouldCommit: target.shouldCommit });
        assertActiveChat(getChatId, target.chatId);
        for (const uid of resolvedDuplicateIds) {
            assertActiveChat(getChatId, target.chatId);
            await lorebooks.removeEntry(uid, target.lorebookName || undefined, { shouldCommit: target.shouldCommit });
        }
        assertActiveChat(getChatId, target.chatId);
        logger?.debug('Merged duplicate lore entries.', { primaryUid, duplicateUids: resolvedDuplicateIds });
        return updated;
    }

    async function preview(payload = {}) {
        const chatId = payload.chatId ?? getChatId?.();
        assertActiveChat(getChatId, chatId);
        const result = await generation.preview({ ...payload, chatId });
        assertActiveChat(getChatId, chatId);
        return result;
    }

    async function apply(previewResult, approvedIndexes) {
        assertActiveChat(getChatId, previewResult?.chatId);
        const result = await generation.apply(previewResult, { approvedIndexes });
        assertActiveChat(getChatId, previewResult?.chatId);
        return result;
    }

    return Object.freeze({ list, protect, merge, preview, apply });
}
