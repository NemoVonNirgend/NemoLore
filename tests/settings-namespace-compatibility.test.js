import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applySettingsDefaults,
    linkExtensionSettingsNamespaces,
} from '../src/core/settings.js';

test('namespace linking keeps the legacy backing object authoritative and copies modular-only values', () => {
    const canonical = { helperMemoryProvider: 'async', memoryContextBudget: 1800 };
    const legacy = { autoMode: true, enabled: false };
    const extensionSettings = { nemolore: canonical, NemoLore: legacy };

    const linked = linkExtensionSettingsNamespaces(extensionSettings);
    assert.equal(linked, legacy);
    assert.equal(extensionSettings.nemolore, legacy);
    assert.equal(extensionSettings.NemoLore, legacy);
    assert.equal(linked.helperMemoryProvider, 'async');
    assert.equal(linked.memoryContextBudget, 1800);
    assert.equal(linked.enabled, false);
});

test('preset hydration preserves namespace identity and global async-provider settings', () => {
    const backing = {
        settingsSchemaVersion: 2,
        preset: 'epic',
        enableAsyncApi: true,
        asyncApiProvider: 'custom',
        asyncApiEndpoint: 'https://example.invalid/v1/chat/completions',
        asyncApiKey: 'secret',
        asyncApiModel: 'model-a',
    };
    const extensionSettings = { NemoLore: backing };
    const linked = linkExtensionSettingsNamespaces(extensionSettings);
    const settings = applySettingsDefaults(linked);

    assert.equal(settings, backing);
    assert.equal(settings, extensionSettings.nemolore);
    assert.equal(settings.preset, 'epic');
    assert.equal(settings.enableAsyncApi, true);
    assert.equal(settings.asyncApiProvider, 'custom');
    assert.equal(settings.asyncApiKey, 'secret');
    assert.equal(settings.asyncApiModel, 'model-a');
});
