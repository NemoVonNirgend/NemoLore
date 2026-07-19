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
    saveMetadata,
    metadataKey,
    state,
    logger,
    clock = Date,
}) {
    if (!adapter) throw new TypeError('Lorebook repository requires an adapter.');
    if (!metadata || typeof metadata !== 'object') {
        throw new TypeError('Lorebook repository requires mutable chat metadata.');
    }
    if (typeof saveMetadata !== 'function') {
        throw new TypeError('Lorebook repository requires saveMetadata().');
    }

    function getAssociatedName() {
        return metadata.nemolore?.lorebook ?? metadata[metadataKey] ?? null;
    }

    async function associate(name) {
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

    async function ensureForChat(chatId) {
        const existing = getAssociatedName();
        if (existing) {
            state.raw.lifecycle.currentChatLorebook = existing;
            return existing;
        }

        const name = buildLorebookName(chatId, clock.now());
        await adapter.create(name);

        metadata.nemolore ??= {};
        metadata.nemolore.created_at = clock.now();
        await associate(name);
        logger?.info('Created chat lorebook.', { chatId, name });
        return name;
    }

    async function load(name = getAssociatedName()) {
        if (!name) throw new Error('No lorebook is associated with the current chat.');
        return adapter.load(name);
    }

    async function createEntry(initializer, name = getAssociatedName()) {
        if (!name) throw new Error('Cannot create an entry without an associated lorebook.');
        return adapter.addEntry(name, initializer);
    }

    async function updateEntry(uid, patch, name = getAssociatedName()) {
        if (!name) throw new Error('Cannot update an entry without an associated lorebook.');
        return adapter.updateEntry(name, uid, patch);
    }

    async function removeEntry(uid, name = getAssociatedName()) {
        if (!name) throw new Error('Cannot remove an entry without an associated lorebook.');
        return adapter.removeEntry(name, uid);
    }

    async function detach() {
        const previous = getAssociatedName();
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
