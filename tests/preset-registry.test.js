import test from 'node:test';
import assert from 'node:assert/strict';

import { createSettings, selectPreset, setPresetOverride } from '../src/core/settings.js';
import { DEFAULT_PRESET_ID, PRESET_IDS, getPreset, listPresets, resolvePreset } from '../src/presets/preset-registry.js';
import { classifyLegacySettings } from '../src/presets/legacy-settings-classifier.js';

test('exposes exactly four immutable story presets with Long Form as default', () => {
    assert.equal(DEFAULT_PRESET_ID, PRESET_IDS.LONG_FORM);
    assert.deepEqual(listPresets().map(preset => preset.id), ['short-rp', 'long-form', 'episodic', 'epic']);
    assert.equal(getPreset('long-form').recommended, true);
    assert.equal(Object.isFrozen(getPreset('epic').settings), true);
});

test('resolves known overrides without mutating the base preset', () => {
    const resolved = resolvePreset('long-form', { runningMemorySize: 42, unknownSetting: true });
    assert.equal(resolved.settings.runningMemorySize, 42);
    assert.equal(resolved.settings.unknownSetting, undefined);
    assert.equal(resolved.customized, true);
    assert.equal(getPreset('long-form').settings.runningMemorySize, 50);
});

test('creates clean installations from the complete Long Form policy', () => {
    const settings = createSettings();
    assert.equal(settings.preset, 'long-form');
    assert.equal(settings.summaryEngineMode, 'modular');
    assert.equal(settings.loreEngineMode, 'modular');
    assert.equal(settings.enableVectorization, true);
    assert.equal(settings.memoryConsolidationEnabled, true);
});

test('classifies representative legacy configurations', () => {
    assert.equal(classifyLegacySettings({ hideMessagesWhenThreshold: false, enableVectorization: false, enableCoreMemories: false }).preset, 'short-rp');
    assert.equal(classifyLegacySettings({ runningMemorySize: 30, enableVectorization: true, vectorSearchLimit: 8 }).preset, 'epic');
    assert.equal(classifyLegacySettings({ summaryInputMaxMessages: 24 }).preset, 'episodic');
    assert.equal(classifyLegacySettings({ runningMemorySize: 50 }).preset, 'long-form');
});

test('records legacy classification while preserving existing values during staged migration', () => {
    const settings = createSettings({ summaryEngineMode: 'legacy', loreEngineMode: 'legacy', runningMemorySize: 75, hideMessagesWhenThreshold: true });
    assert.equal(settings.preset, 'long-form');
    assert.equal(settings.summaryEngineMode, 'legacy');
    assert.equal(settings.runningMemorySize, 75);
    assert.equal(settings.presetMigration.legacyValuesPreserved, true);
});

test('reopens modern preset settings from their base policy plus explicit overrides', () => {
    const settings = createSettings({ settingsSchemaVersion: 2, preset: 'epic', presetOverrides: { runningMemorySize: 28 } });
    assert.equal(settings.runningMemorySize, 28);
    assert.equal(settings.vectorSearchLimit, 8);
    assert.equal(settings.presetMigration, null);
});

test('switches profiles without losing providers or unrelated user settings', () => {
    const current = createSettings({
        settingsSchemaVersion: 2,
        preset: 'short-rp',
        asyncApiKey: 'preserved-secret',
        highlightNouns: false,
        chatSummaries: { chat: 'Existing summary' },
    });
    const epic = selectPreset(current, 'epic');
    assert.equal(epic.runningMemorySize, 30);
    assert.equal(epic.enableVectorization, true);
    assert.equal(epic.asyncApiKey, 'preserved-secret');
    assert.equal(epic.highlightNouns, false);
    assert.deepEqual(epic.chatSummaries, { chat: 'Existing summary' });
});

test('records advanced changes as explicit preset overrides', () => {
    const customized = setPresetOverride(createSettings(), 'runningMemorySize', 44);
    assert.equal(customized.preset, 'long-form');
    assert.equal(customized.runningMemorySize, 44);
    assert.deepEqual(customized.presetOverrides, { runningMemorySize: 44 });
    assert.throws(() => setPresetOverride(customized, 'asyncApiKey', 'nope'), /not controlled/);
});
