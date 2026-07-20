import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    applySettingsDefaults,
    isLegacyLoreEngine,
    isLegacySummaryEngine,
    linkExtensionSettingsNamespaces,
} from '../src/core/settings.js';

test('upgrade preserves legacy conflicts and copies lowercase-only modular settings', () => {
    const canonical = { summaryEngineMode: 'modular', enabled: true };
    const legacy = { enabled: false, autoMode: true };
    const extensionSettings = {
        nemolore: canonical,
        NemoLore: legacy,
    };

    const shared = linkExtensionSettingsNamespaces(extensionSettings);

    assert.equal(shared, legacy);
    assert.equal(extensionSettings.nemolore, shared);
    assert.equal(extensionSettings.NemoLore, shared);
    assert.equal(shared.enabled, false);
    assert.equal(shared.autoMode, true);
    assert.equal(shared.summaryEngineMode, 'modular');

    extensionSettings.NemoLore.loreEngineMode = 'modular';
    assert.equal(extensionSettings.nemolore.loreEngineMode, 'modular');
});

test('upgrade fixture links namespaces without losing historical preferences', async () => {
    const { default: fixture } = await import('./fixtures/settings-upgrade.json', {
        with: { type: 'json' },
    });
    const extensionSettings = structuredClone(fixture.extensionSettings);
    const legacy = extensionSettings.NemoLore;

    const shared = linkExtensionSettingsNamespaces(extensionSettings);

    assert.equal(shared, legacy);
    assert.deepEqual(shared, fixture.expected);
    assert.equal(extensionSettings.nemolore, legacy);
    assert.equal(extensionSettings.NemoLore, legacy);
});

test('legacy-only settings migrate without replacing their backing object', () => {
    const legacy = { autoMode: true };
    const extensionSettings = { NemoLore: legacy };

    const shared = linkExtensionSettingsNamespaces(extensionSettings);

    assert.equal(shared, legacy);
    assert.equal(extensionSettings.nemolore, legacy);
    assert.equal(extensionSettings.NemoLore, legacy);
});

test('default hydration preserves strict identity and engine policies stay live', () => {
    const legacy = { summaryEngineMode: 'legacy', loreEngineMode: 'legacy' };
    const extensionSettings = { NemoLore: legacy };
    const linked = linkExtensionSettingsNamespaces(extensionSettings);

    const settings = applySettingsDefaults(linked);

    assert.equal(settings, legacy);
    assert.equal(settings, extensionSettings.nemolore);
    assert.equal(settings, extensionSettings.NemoLore);
    assert.equal(settings.enableHelperAgents, false);

    extensionSettings.NemoLore.summaryEngineMode = 'modular';
    extensionSettings.NemoLore.loreEngineMode = 'modular';
    assert.equal(isLegacySummaryEngine(settings), false);
    assert.equal(isLegacyLoreEngine(settings), false);
});

test('bootstrap exposes the exact linked and hydrated settings backing object', async () => {
    const source = await readFile('bootstrap.js', 'utf8');

    assert.match(source, /const settingsBacking = linkExtensionSettingsNamespaces\(extension_settings\)/);
    assert.match(source, /const settings = applySettingsDefaults\(settingsBacking\)/);
    assert.doesNotMatch(source, /const settings = createSettings\(settingsBacking\)/);
});

test('engine predicates default to legacy and select modular explicitly', () => {
    assert.equal(isLegacySummaryEngine({}), true);
    assert.equal(isLegacySummaryEngine({ summaryEngineMode: 'legacy' }), true);
    assert.equal(isLegacySummaryEngine({ summaryEngineMode: 'modular' }), false);
    assert.equal(isLegacyLoreEngine({}), true);
    assert.equal(isLegacyLoreEngine({ loreEngineMode: 'legacy' }), true);
    assert.equal(isLegacyLoreEngine({ loreEngineMode: 'modular' }), false);
});
