export const SUMMARY_ENGINE_MODES = Object.freeze({
    LEGACY: 'legacy',
    MODULAR: 'modular',
});

export function createSummaryCompatibilityCoordinator({ settings, extensionSettings, logger } = {}) {
    if (!settings) throw new TypeError('Summary compatibility coordinator requires settings.');
    if (!extensionSettings || typeof extensionSettings !== 'object') {
        throw new TypeError('Summary compatibility coordinator requires extension settings.');
    }

    const originalLegacySettings = extensionSettings.nemolore
        ? structuredClone(extensionSettings.nemolore)
        : null;

    function mode() {
        return settings.summaryEngineMode === SUMMARY_ENGINE_MODES.MODULAR
            ? SUMMARY_ENGINE_MODES.MODULAR
            : SUMMARY_ENGINE_MODES.LEGACY;
    }

    function prepareLegacyImport() {
        if (mode() !== SUMMARY_ENGINE_MODES.MODULAR) return false;
        extensionSettings.nemolore ??= {};
        Object.assign(extensionSettings.nemolore, {
            enableSummarization: false,
            autoSummarize: false,
            enablePairedSummarization: false,
        });
        logger?.info('Suppressed legacy summary generation for modular summary mode.');
        return true;
    }

    function restorePersistedSettings() {
        if (!originalLegacySettings || mode() !== SUMMARY_ENGINE_MODES.MODULAR) return false;
        Object.assign(extensionSettings.nemolore, originalLegacySettings);
        return true;
    }

    function shouldRunModularSummary() {
        return mode() === SUMMARY_ENGINE_MODES.MODULAR
            && Boolean(settings.enableHelperAgents)
            && Boolean(settings.helperSummaryAfterReply);
    }

    return Object.freeze({
        mode,
        prepareLegacyImport,
        restorePersistedSettings,
        shouldRunModularSummary,
    });
}
