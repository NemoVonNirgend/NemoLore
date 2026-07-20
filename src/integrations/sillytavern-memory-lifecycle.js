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

    async function activate(chatId = getChatId?.()) {
        const nextChatId = chatId ? String(chatId) : null;
        if (!nextChatId) return { loaded: 0, migrated: 0, skipped: true };
        if (currentChatId && currentChatId !== nextChatId) {
            try { await persistence.flush(); } catch (error) { logger?.error('Unable to flush previous chat memory.', error); }
        }

        currentChatId = nextChatId;
        const loaded = persistence.start(nextChatId);
        const migration = await migrator?.migrate(nextChatId) ?? { migrated: 0 };
        if (migration.migrated || migration.upgraded || migration.summaryImported) await persistence.flush();
        logger?.debug('Activated chat memory persistence.', { chatId: nextChatId, loaded: loaded.length, migrated: migration.migrated });
        return { loaded: loaded.length, migrated: migration.migrated ?? 0, skipped: false };
    }

    function onChatChanged(chatId) {
        void activate(chatId).catch(error => logger?.error('Chat memory activation failed.', error));
    }

    function install() {
        if (installed) return false;
        if (chatChangedEvent) eventSource.on(chatChangedEvent, onChatChanged);
        if (chatLoadedEvent && chatLoadedEvent !== chatChangedEvent) eventSource.on(chatLoadedEvent, onChatChanged);
        installed = true;
        void activate();
        return true;
    }

    function uninstall() {
        if (!installed) return false;
        if (chatChangedEvent) {
            eventSource.removeListener?.(chatChangedEvent, onChatChanged);
            eventSource.off?.(chatChangedEvent, onChatChanged);
        }
        if (chatLoadedEvent && chatLoadedEvent !== chatChangedEvent) {
            eventSource.removeListener?.(chatLoadedEvent, onChatChanged);
            eventSource.off?.(chatLoadedEvent, onChatChanged);
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
