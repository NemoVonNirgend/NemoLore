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

    function loreMode() {
        return settings.loreEngineMode === 'modular' ? 'modular' : 'legacy';
    }

    function needsSuppression() {
        return mode() === SUMMARY_ENGINE_MODES.MODULAR || loreMode() === 'modular';
    }

    function prepareLegacyImport() {
        if (!needsSuppression()) return false;
        extensionSettings.nemolore ??= {};
        if (mode() === SUMMARY_ENGINE_MODES.MODULAR) {
            Object.assign(extensionSettings.nemolore, {
                enableSummarization: false,
                autoSummarize: false,
                enablePairedSummarization: false,
            });
        }
        if (loreMode() === 'modular') {
            extensionSettings.nemolore.autoMode = false;
        }
        logger?.info('Suppressed legacy automatic generation for selected modular engines.', {
            summaryMode: mode(),
            loreMode: loreMode(),
        });
        return true;
    }

    function restoreNow() {
        if (!originalLegacySettings || !needsSuppression()) return false;
        if (restoreTimer) cancel(restoreTimer);
        restoreTimer = null;
        Object.assign(extensionSettings.nemolore, originalLegacySettings);
        logger?.debug('Restored persisted legacy preferences after modular suppression.');
        return true;
    }

    function restorePersistedSettings() {
        if (!originalLegacySettings || !needsSuppression()) return false;
        if (restoreTimer) cancel(restoreTimer);
        restoreTimer = schedule(() => restoreNow(), restoreDelayMs);
        return true;
    }

    function shouldRunModularSummary() {
        return mode() === SUMMARY_ENGINE_MODES.MODULAR
            && Boolean(settings.enableHelperAgents)
            && Boolean(settings.helperSummaryAfterReply);
    }

    function shouldRunModularLore() {
        return loreMode() === 'modular'
            && Boolean(settings.enableHelperAgents)
            && Boolean(settings.helperLoreAfterReply);
    }

    function dispose() {
        if (restoreTimer) cancel(restoreTimer);
        restoreTimer = null;
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
        get restorePending() { return Boolean(restoreTimer); },
    });
}
