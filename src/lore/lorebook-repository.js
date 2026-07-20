import { createChatMetadataAccessor } from '../core/chat-metadata-accessor.js';
import { createActiveChatGuard } from '../core/active-chat-guard.js';
import { createKeyedLock } from '../core/keyed-lock.js';
import { MODULE_NAME, NEMOLORE_LOREBOOK_PREFIX } from '../core/constants.js';

function buildLorebookName(chatId, now = Date.now()) {
    const safeChatId = String(chatId).replace(/[^a-zA-Z0-9_-]+/g, '_');
    return `${NEMOLORE_LOREBOOK_PREFIX}${safeChatId}_${now}`;
}

/**
 * Repository-style lorebook API.
 *
 * This service owns chat-to-lorebook association and metadata. It delegates
 * physical persistence to the adapter and never calls SillyTavern APIs itself.
 */
export function createLorebookRepository({
    adapter,
    metadata,
    getMetadata,
    saveMetadata,
    metadataKey,
    state,
    logger,
    getActiveChatId,
    clock = Date,
}) {
    if (!adapter) throw new TypeError('Lorebook repository requires an adapter.');
    const currentMetadata = createChatMetadataAccessor({ metadata, getMetadata }, 'Lorebook repository');
    if (typeof saveMetadata !== 'function') {
        throw new TypeError('Lorebook repository requires saveMetadata().');
    }
    const ensureLock = createKeyedLock();

    function getAssociatedName() {
        const metadata = currentMetadata();
        return metadata.nemolore?.lorebook ?? metadata[metadataKey] ?? null;
    }

    async function associate(name, { shouldCommit } = {}) {
        if (shouldCommit && !shouldCommit()) return null;
        const metadata = currentMetadata();
        metadata[metadataKey] = name;
        metadata.nemolore ??= {};
        Object.assign(metadata.nemolore, {
            lorebook: name,
            created_by: metadata.nemolore.created_by ?? MODULE_NAME,
            updated_at: clock.now(),
        });

        state.raw.lifecycle.currentChatLorebook = name;
        await saveMetadata();
        return name;
    }

    async function ensureForChat(chatId, { shouldCommit } = {}) {
        const canCommit = shouldCommit ?? createActiveChatGuard(getActiveChatId, chatId);
        return ensureLock.run(`lorebook:${chatId}`, async () => {
            if (!canCommit()) return null;

<<<<<<< HEAD
            // Recheck inside the per-chat lock because another concurrent
            // ensure may have created and associated the book while waiting.
=======
>>>>>>> dev/preset-architecture
            const existing = getAssociatedName();
            if (existing) {
                state.raw.lifecycle.currentChatLorebook = existing;
                return existing;
            }

            const name = buildLorebookName(chatId, clock.now());
            await adapter.create(name);
            if (!canCommit()) {
                await adapter.remove?.(name);
                return null;
            }

            const metadata = currentMetadata();
            metadata.nemolore ??= {};
            metadata.nemolore.created_at = clock.now();
            await associate(name, { shouldCommit: canCommit });
            logger?.info('Created chat lorebook.', { chatId, name });
            return name;
        });
    }

    async function load(name = getAssociatedName()) {
        if (!name) throw new Error('No lorebook is associated with the current chat.');
        return adapter.load(name);
    }

    async function createEntry(initializer, name = getAssociatedName(), options = {}) {
        if (!name) throw new Error('Cannot create an entry without an associated lorebook.');
        if (options.shouldCommit && !options.shouldCommit()) return null;
        return options.shouldCommit
            ? adapter.addEntry(name, initializer, options)
            : adapter.addEntry(name, initializer);
    }

    async function updateEntry(uid, patch, name = getAssociatedName(), options = {}) {
        if (!name) throw new Error('Cannot update an entry without an associated lorebook.');
        if (options.shouldCommit && !options.shouldCommit()) return null;
        return options.shouldCommit
            ? adapter.updateEntry(name, uid, patch, options)
            : adapter.updateEntry(name, uid, patch);
    }

    async function removeEntry(uid, name = getAssociatedName(), options = {}) {
        if (!name) throw new Error('Cannot remove an entry without an associated lorebook.');
        if (options.shouldCommit && !options.shouldCommit()) return false;
        return options.shouldCommit
            ? adapter.removeEntry(name, uid, options)
            : adapter.removeEntry(name, uid);
    }

    async function detach() {
        const previous = getAssociatedName();
        const metadata = currentMetadata();
        delete metadata[metadataKey];
        if (metadata.nemolore) delete metadata.nemolore.lorebook;
        state.raw.lifecycle.currentChatLorebook = null;
        await saveMetadata();
        return previous;
    }

    return Object.freeze({
        getAssociatedName,
        associate,
        ensureForChat,
        load,
        createEntry,
        updateEntry,
        removeEntry,
        detach,
    });
}

export { buildLorebookName };
