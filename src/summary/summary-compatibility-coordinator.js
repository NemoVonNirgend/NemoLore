export const SUMMARY_ENGINE_MODES = Object.freeze({
    MODULAR: 'modular',
});

export function createSummaryCompatibilityCoordinator({
    settings,
    extensionSettings,
    logger,
} = {}) {
    if (!settings) throw new TypeError('Summary compatibility coordinator requires settings.');
    if (!extensionSettings || typeof extensionSettings !== 'object') {
        throw new TypeError('Summary compatibility coordinator requires extension settings.');
    }

    function mode() {
        return SUMMARY_ENGINE_MODES.MODULAR;
    }

    function loreMode() {
        return 'modular';
    }

    function prepareLegacyImport() {
        extensionSettings.nemolore ??= {};
        Object.assign(extensionSettings.nemolore, {
            enableSummarization: false,
            autoSummarize: false,
            enablePairedSummarization: false,
            autoMode: false,
        });
        logger?.info('Disabled retired legacy automatic generation after modular cutover.');
        return true;
    }

    function restoreNow() {
        return false;
    }

    function restorePersistedSettings() {
        return false;
    }

    function shouldRunModularSummary() {
        return Boolean(settings.enableHelperAgents)
            && Boolean(settings.helperSummaryAfterReply);
    }

    function shouldRunModularLore() {
        return Boolean(settings.enableHelperAgents)
            && Boolean(settings.helperLoreAfterReply);
    }

    function dispose() {
        return undefined;
    }

    return Object.freeze({
        mode,
        loreMode,
        prepareLegacyImport,
        restorePersistedSettings,
        restoreNow,
        shouldRunModularSummary,
        shouldRunModularLore,
        dispose,
        get restorePending() { return false; },
    });
}
