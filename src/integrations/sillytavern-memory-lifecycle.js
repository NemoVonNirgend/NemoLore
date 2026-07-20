export function createSillyTavernMemoryLifecycle({
    eventSource,
    chatChangedEvent,
    chatLoadedEvent,
    getChatId,
    persistence,
    migrator,
    logger,
} = {}) {
    if (!eventSource?.on) throw new TypeError('Memory lifecycle requires an event source.');
    if (!persistence?.start || !persistence?.flush) throw new TypeError('Memory lifecycle requires persistence.');

    let installed = false;
    let currentChatId = null;
    let activationQueue = Promise.resolve();

    function staleResult(nextChatId) {
        const activeChatId = getChatId?.();
        if (activeChatId == null || String(activeChatId) === nextChatId) return null;
        return {
            loaded: 0, migrated: 0, skipped: true, reason: 'stale-chat',
            requestedChatId: nextChatId, activeChatId: String(activeChatId),
        };
    }

    async function activateNow(chatId, { force = false } = {}) {
        const nextChatId = chatId ? String(chatId) : null;
        if (!nextChatId) return { loaded: 0, migrated: 0, skipped: true };
        if (staleResult(nextChatId)) return staleResult(nextChatId);
        if (currentChatId === nextChatId && !force) {
            return { loaded: 0, migrated: 0, skipped: true, reason: 'already-active' };
        }
        if (currentChatId && currentChatId !== nextChatId) {
            try { await persistence.flush(); } catch (error) { logger?.error('Unable to flush previous chat memory.', error); }
        }

        if (staleResult(nextChatId)) return staleResult(nextChatId);
        const loaded = persistence.start(nextChatId);
        const migration = await migrator?.migrate(nextChatId) ?? { migrated: 0 };
        if (staleResult(nextChatId)) return staleResult(nextChatId);
        if (migration.migrated) await persistence.flush();
        if (staleResult(nextChatId)) return staleResult(nextChatId);
        currentChatId = nextChatId;
        logger?.debug('Activated chat memory persistence.', { chatId: nextChatId, loaded: loaded.length, migrated: migration.migrated });
        return { loaded: loaded.length, migrated: migration.migrated ?? 0, skipped: false };
    }

    function activate(chatId = getChatId?.(), options = {}) {
        const requestedChatId = chatId;
        const activation = activationQueue.then(() => activateNow(requestedChatId, options));
        activationQueue = activation.catch(() => {});
        return activation;
    }

    function onChatChanged(eventChatId) {
        const chatId = typeof eventChatId === 'string' || typeof eventChatId === 'number'
            ? eventChatId
            : getChatId?.();
        void activate(chatId).catch(error => logger?.error('Chat memory activation failed.', error));
    }

    function onChatLoaded(eventChatId) {
        const chatId = typeof eventChatId === 'string' || typeof eventChatId === 'number'
            ? eventChatId
            : getChatId?.();
        void activate(chatId, { force: true }).catch(error => logger?.error('Loaded chat memory activation failed.', error));
    }

    function install() {
        if (installed) return false;
        if (chatChangedEvent) eventSource.on(chatChangedEvent, onChatChanged);
        if (chatLoadedEvent && chatLoadedEvent !== chatChangedEvent) eventSource.on(chatLoadedEvent, onChatLoaded);
        installed = true;
        void activate().catch(error => logger?.error('Initial chat memory activation failed.', error));
        return true;
    }

    function uninstall() {
        if (!installed) return false;
        if (chatChangedEvent) {
            eventSource.removeListener?.(chatChangedEvent, onChatChanged);
            eventSource.off?.(chatChangedEvent, onChatChanged);
        }
        if (chatLoadedEvent && chatLoadedEvent !== chatChangedEvent) {
            eventSource.removeListener?.(chatLoadedEvent, onChatLoaded);
            eventSource.off?.(chatLoadedEvent, onChatLoaded);
        }
        persistence.stop?.();
        installed = false;
        return true;
    }

    return Object.freeze({
        install,
        uninstall,
        activate,
        get currentChatId() { return currentChatId; },
        get installed() { return installed; },
    });
}
