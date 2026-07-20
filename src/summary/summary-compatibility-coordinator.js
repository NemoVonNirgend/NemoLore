export const SUMMARY_ENGINE_MODES = Object.freeze({
    LEGACY: 'legacy',
    MODULAR: 'modular',
});

export function createSummaryCompatibilityCoordinator({
    settings,
    extensionSettings,
    logger,
    restoreDelayMs = 1_500,
    schedule = setTimeout,
    cancel = clearTimeout,
} = {}) {
    if (!settings) throw new TypeError('Summary compatibility coordinator requires settings.');
    if (!extensionSettings || typeof extensionSettings !== 'object') {
        throw new TypeError('Summary compatibility coordinator requires extension settings.');
    }

    const originalLegacySettings = extensionSettings.nemolore
        ? structuredClone(extensionSettings.nemolore)
        : null;
    let restoreTimer = null;

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

    function restoreNow() {
        if (!originalLegacySettings || mode() !== SUMMARY_ENGINE_MODES.MODULAR) return false;
        if (restoreTimer) cancel(restoreTimer);
        restoreTimer = null;
        Object.assign(extensionSettings.nemolore, originalLegacySettings);
        logger?.debug('Restored persisted legacy summary preferences after modular suppression.');
        return true;
    }

    function restorePersistedSettings() {
        if (!originalLegacySettings || mode() !== SUMMARY_ENGINE_MODES.MODULAR) return false;
        if (restoreTimer) cancel(restoreTimer);
        restoreTimer = schedule(() => restoreNow(), restoreDelayMs);
        return true;
    }

    function shouldRunModularSummary() {
        return mode() === SUMMARY_ENGINE_MODES.MODULAR
            && Boolean(settings.enableHelperAgents)
            && Boolean(settings.helperSummaryAfterReply);
    }

    function dispose() {
        if (restoreTimer) cancel(restoreTimer);
        restoreTimer = null;
    }

    return Object.freeze({
        mode,
        prepareLegacyImport,
        restorePersistedSettings,
        restoreNow,
        shouldRunModularSummary,
        dispose,
        get restorePending() { return Boolean(restoreTimer); },
    });
}
