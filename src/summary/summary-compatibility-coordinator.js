import { linkExtensionSettingsNamespaces } from '../core/settings.js';

export const SUMMARY_ENGINE_MODES = Object.freeze({
    LEGACY: 'legacy',
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
        linkExtensionSettingsNamespaces(extensionSettings);
        if (!needsSuppression()) return false;
        logger?.info('Selected modular engines will gate legacy automatic generation.', {
            summaryMode: mode(),
            loreMode: loreMode(),
        });
        return true;
    }

    function restoreNow() {
        return false;
    }

    function restorePersistedSettings() {
        return false;
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

    function dispose() {}

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
