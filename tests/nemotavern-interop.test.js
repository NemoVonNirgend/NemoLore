import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ENGINE_OWNERS,
    createEngineOwnership,
    createNemoTavernHostInterop,
} from '../src/integrations/nemotavern-host-interop.js';

test('engine ownership resolves stock legacy, NemoTavern, and modular modes dynamically', () => {
    const scope = {};
    const settings = {
        summaryEngineMode: 'legacy',
        loreEngineMode: 'legacy',
        enableHelperAgents: false,
        helperMemoryAfterReply: true,
    };
    const hostInterop = createNemoTavernHostInterop({ scope });
    const ownership = createEngineOwnership({ settings, hostInterop });

    assert.deepEqual(ownership.snapshot(), {
        summaryOwner: ENGINE_OWNERS.LEGACY,
        loreOwner: ENGINE_OWNERS.LEGACY,
        memoryOwner: ENGINE_OWNERS.NONE,
    });

    scope.NemoTavern = {
        version: 'test',
        capabilities: { snapshot: () => ({ memory: true, lore: true }) },
        memory: { snapshot: () => ({ summaries: [] }) },
        lore: {},
    };
    assert.deepEqual(ownership.snapshot(), {
        summaryOwner: ENGINE_OWNERS.NEMOTAVERN,
        loreOwner: ENGINE_OWNERS.NEMOTAVERN,
        memoryOwner: ENGINE_OWNERS.NEMOTAVERN,
    });

    settings.summaryEngineMode = 'modular';
    settings.loreEngineMode = 'modular';
    settings.enableHelperAgents = true;
    assert.deepEqual(ownership.snapshot(), {
        summaryOwner: ENGINE_OWNERS.MODULAR,
        loreOwner: ENGINE_OWNERS.MODULAR,
        memoryOwner: ENGINE_OWNERS.MODULAR,
    });
    assert.equal(ownership.ownerFor('summary'), ENGINE_OWNERS.MODULAR);
    assert.equal(ownership.owns('memory'), true);
});

test('legacy summary ownership follows the native worker that can actually run', () => {
    const active = { memory: true, lore: true, summary: true, memorySummary: true, loreSummary: false };
    const scope = { NemoTavern: {
        capabilities: {
            snapshot: () => ({ memory: true, lore: true, summary: true }),
            active: () => active,
        },
        memory: { isEnabled: () => true },
        lore: { isEnabled: () => true, isSummaryEnabled: () => active.loreSummary },
    } };
    const settings = {
        summaryEngineMode: 'legacy',
        loreEngineMode: 'legacy',
        enableHelperAgents: false,
        helperMemoryAfterReply: true,
    };
    const ownership = createEngineOwnership({
        settings,
        hostInterop: createNemoTavernHostInterop({ scope }),
    });

    assert.equal(ownership.ownerFor('summary'), ENGINE_OWNERS.NEMOTAVERN);
    settings.enableHelperAgents = true;
    assert.equal(ownership.ownerFor('memory'), ENGINE_OWNERS.MODULAR);
    assert.equal(ownership.ownerFor('summary'), ENGINE_OWNERS.LEGACY);
    active.loreSummary = true;
    assert.equal(ownership.ownerFor('summary'), ENGINE_OWNERS.NEMOTAVERN);
    settings.loreEngineMode = 'modular';
    assert.equal(ownership.ownerFor('lore'), ENGINE_OWNERS.MODULAR);
    assert.equal(ownership.ownerFor('summary'), ENGINE_OWNERS.LEGACY);
});

test('inactive native engines do not take ownership merely because their APIs exist', () => {
    const scope = { NemoTavern: {
        capabilities: { snapshot: () => ({ memory: true, lore: true }) },
        memory: { snapshot: () => ({ settings: { enabled: false } }) },
        lore: { snapshot: () => ({ settings: { enabled: false, summaryTakeover: true } }) },
    } };
    const ownership = createEngineOwnership({
        settings: { summaryEngineMode: 'legacy', loreEngineMode: 'legacy' },
        hostInterop: createNemoTavernHostInterop({ scope }),
    });
    assert.deepEqual(ownership.snapshot(), {
        summaryOwner: ENGINE_OWNERS.LEGACY, loreOwner: ENGINE_OWNERS.LEGACY, memoryOwner: ENGINE_OWNERS.NONE,
    });
});

test('current host active-state checks do not clone full memory or lore stores', () => {
    const fullSnapshot = () => { throw new Error('full snapshot should not run during ownership checks'); };
    const scope = { NemoTavern: {
        capabilities: {
            snapshot: () => ({ memory: true, lore: true, summary: true }),
            active: () => ({ memory: true, lore: true, summary: true }),
        },
        memory: { snapshot: fullSnapshot, isEnabled: () => true },
        lore: { snapshot: fullSnapshot, isEnabled: () => true, isSummaryEnabled: () => true },
    } };
    const ownership = createEngineOwnership({
        settings: { summaryEngineMode: 'legacy', loreEngineMode: 'legacy' },
        hostInterop: createNemoTavernHostInterop({ scope }),
    });
    assert.deepEqual(ownership.snapshot(), {
        summaryOwner: ENGINE_OWNERS.NEMOTAVERN,
        loreOwner: ENGINE_OWNERS.NEMOTAVERN,
        memoryOwner: ENGINE_OWNERS.NEMOTAVERN,
    });
});

test('host interop snapshots native memory ledger and provenance without retaining host references', () => {
    const memory = { summaries: [{ messageId: 2, summary: 'The key was found.' }], chunks: [{ count: 2, text: 'A recap.' }] };
    const provenance = { promptHash: 'abc', model: 'model-a' };
    const adapter = createNemoTavernHostInterop({
        scope: {
            NemoTavern: {
                capabilities: { snapshot: () => ({ memory: true, provenance: true }) },
                memory: { snapshot: () => memory },
                provenance: { summary: () => provenance },
            },
        },
    });

    const snapshot = adapter.observabilitySnapshot();
    assert.deepEqual(snapshot.memory, memory);
    assert.deepEqual(snapshot.contextLedger, memory);
    assert.deepEqual(snapshot.provenance, provenance);
});
