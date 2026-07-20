export const LORE_ENGINE_MODES = Object.freeze({
    LEGACY: 'legacy',
    MODULAR: 'modular',
});

export function createLoreCompatibilityCoordinator({ settings, extensionSettings, logger } = {}) {
    if (!settings) throw new TypeError('Lore compatibility coordinator requires settings.');
    if (!extensionSettings || typeof extensionSettings !== 'object') {
        throw new TypeError('Lore compatibility coordinator requires extension settings.');
    }

    const original = extensionSettings.nemolore
        ? structuredClone(extensionSettings.nemolore)
        : null;
    let prepared = false;

    function mode() {
        return settings.loreEngineMode === LORE_ENGINE_MODES.MODULAR
            ? LORE_ENGINE_MODES.MODULAR
            : LORE_ENGINE_MODES.LEGACY;
    }

    function prepareLegacyImport() {
        if (mode() !== LORE_ENGINE_MODES.MODULAR) return false;
        extensionSettings.nemolore ??= {};
        Object.assign(extensionSettings.nemolore, {
            autoMode: false,
        });
        prepared = true;
        logger?.info('Suppressed legacy automatic lore generation for modular lore mode.');
        return true;
    }

    function restorePersistedSettings() {
        if (!prepared || !original) return false;
        Object.assign(extensionSettings.nemolore, original);
        prepared = false;
        return true;
    }

    function scheduleRestore(delayMs = 0) {
        if (!prepared) return false;
        setTimeout(() => restorePersistedSettings(), Math.max(0, delayMs));
        return true;
    }

    function shouldRunModularLore() {
        return mode() === LORE_ENGINE_MODES.MODULAR
            && Boolean(settings.enableHelperAgents)
            && Boolean(settings.helperLoreAfterReply);
    }

    return Object.freeze({
        mode,
        prepareLegacyImport,
        restorePersistedSettings,
        scheduleRestore,
        shouldRunModularLore,
    });
}
