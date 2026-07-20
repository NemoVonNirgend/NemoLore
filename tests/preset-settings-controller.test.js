import test from 'node:test';
import assert from 'node:assert/strict';

import { createSettings } from '../src/core/settings.js';
import { createModularSettingsController } from '../src/ui/modular-settings-controller.js';

test('settings controller switches complete profiles and persists the result', () => {
    const settings = createSettings({ settingsSchemaVersion: 2, preset: 'short-rp' });
    const saves = [];
    const controller = createModularSettingsController({ settings, save: value => saves.push({ ...value }) });
    controller.selectPreset('epic');
    assert.equal(settings.preset, 'epic');
    assert.equal(settings.runningMemorySize, 30);
    assert.equal(settings.vectorSearchLimit, 8);
    assert.equal(saves.length, 1);
});

test('advanced profile changes become overrides while provider changes remain global', () => {
    const settings = createSettings();
    const controller = createModularSettingsController({ settings });
    controller.set('memoryContextBudget', 1_800);
    controller.set('helperAgentProvider', 'background-provider');
    assert.equal(settings.preset, 'long-form');
    assert.deepEqual(settings.presetOverrides, { memoryContextBudget: 1_800 });
    assert.equal(settings.helperAgentProvider, 'background-provider');
});
