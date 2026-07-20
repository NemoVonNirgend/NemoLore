import { linkExtensionSettingsNamespaces } from '../core/settings.js';

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
<<<<<<< HEAD
        linkExtensionSettingsNamespaces(extensionSettings);
        if (!needsSuppression()) return false;
        logger?.info('Selected modular engines will gate legacy automatic generation.', {
            summaryMode: mode(),
            loreMode: loreMode(),
=======
        extensionSettings.nemolore ??= {};
        Object.assign(extensionSettings.nemolore, {
            enableSummarization: false,
            autoSummarize: false,
            enablePairedSummarization: false,
            autoMode: false,
>>>>>>> dev/preset-architecture
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

<<<<<<< HEAD
    function dispose() {}
=======
    function dispose() {
        return undefined;
    }
>>>>>>> dev/preset-architecture

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
