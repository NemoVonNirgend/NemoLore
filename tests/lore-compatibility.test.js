import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyedLock } from '../src/core/keyed-lock.js';
import { createLoreEntityIndex } from '../src/lore/lore-entity-index.js';
import { createLoreGenerationService } from '../src/lore/lore-generation-service.js';
import { createSummaryCompatibilityCoordinator } from '../src/summary/summary-compatibility-coordinator.js';
import { createPostReplyDispatcher } from '../src/agents/post-reply-dispatcher.js';

function createRepository(initialEntries = {}) {
    const lorebook = { entries: structuredClone(initialEntries) };
    let nextUid = 100;
    const calls = [];
    return {
        calls,
        lorebook,
        async ensureForChat() { return 'Book'; },
        async load() { return structuredClone(lorebook); },
        async createEntry(value) {
            const uid = nextUid++;
            lorebook.entries[uid] = { uid, ...value };
            calls.push(['create', uid, value]);
            return lorebook.entries[uid];
        },
        async updateEntry(uid, patch) {
            lorebook.entries[uid] = { ...lorebook.entries[uid], ...patch, uid };
            calls.push(['update', uid, patch]);
            return lorebook.entries[uid];
        },
    };
}

test('modular lore mode selects modular work without mutating manual legacy settings', () => {
    const canonical = { autoMode: true, autoCreateLorebook: true, createLorebookOnChat: true };
    const extensionSettings = { nemolore: canonical };
    const coordinator = createSummaryCompatibilityCoordinator({
        settings: { summaryEngineMode: 'legacy', loreEngineMode: 'modular', enableHelperAgents: true, helperLoreAfterReply: true },
        extensionSettings,
    });
    assert.equal(coordinator.prepareLegacyImport(), true);
    assert.equal(extensionSettings.NemoLore, canonical);
    assert.equal(extensionSettings.nemolore.autoMode, true);
    assert.equal(extensionSettings.nemolore.autoCreateLorebook, true);
    assert.equal(extensionSettings.nemolore.createLorebookOnChat, true);
    assert.equal(coordinator.shouldRunModularLore(), true);
});

test('legacy lore mode never queues modular lore work', () => {
    let requests = null;
    const dispatcher = createPostReplyDispatcher({
        runtime: { enqueueMany(value) { requests = value; return value; } },
        settings: { enableHelperAgents: true, summaryEngineMode: 'legacy', loreEngineMode: 'legacy', helperMemoryAfterReply: true, helperLoreAfterReply: true, helperSummaryAfterReply: false },
        policy: { select: () => ({ selected: [{ workflow: 'memory' }, { workflow: 'lore' }], decisions: [] }) },
        providerRouter: { routeFor: () => 'async' },
    });
    dispatcher.dispatch({ chatId: 'chat', messageId: '1', input: 'Marcus arrived.', sources: [], context: {} });
    assert.deepEqual(requests.map(request => request.agent), ['memory']);
});

test('model create converges to update when identity already exists', async () => {
    const repository = createRepository({ 7: { uid: 7, key: ['Marcus'], comment: 'Marcus', content: 'Old text written manually.' } });
    const service = createLoreGenerationService({
        generation: { async generate() { return { text: JSON.stringify({ entries: [{ action: 'create', key: 'marcus', title: 'Marcus', content: 'Marcus reached the station.', keywords: ['Marcus'] }] }) }; } },
        lorebooks: repository,
        lock: createKeyedLock(),
        entityIndex: createLoreEntityIndex(),
    });
    const result = await service.generate({ chatId: 'chat', input: 'Marcus reached the station.' });
    assert.equal(repository.calls[0][0], 'update');
    assert.equal(repository.calls[0][1], 7);
    assert.equal(result.applied[0].action, 'update');
    assert.equal(result.applied[0].matchedIdentity, 'marcus');
});

test('noop operations never write and manual entries remain untouched', async () => {
    const repository = createRepository({ 4: { uid: 4, key: ['Elena'], comment: 'Elena', content: 'Manual prose.' } });
    const service = createLoreGenerationService({
        generation: { async generate() { return { text: JSON.stringify({ entries: [{ action: 'noop', key: 'Elena', title: 'Elena', content: '', keywords: ['Elena'] }] }) }; } },
        lorebooks: repository,
        lock: createKeyedLock(),
        entityIndex: createLoreEntityIndex(),
    });
    const result = await service.generate({ chatId: 'chat', input: 'Elena drank tea.' });
    assert.equal(repository.calls.length, 0);
    assert.equal(repository.lorebook.entries[4].content, 'Manual prose.');
    assert.equal(result.applied[0].reason, 'model-noop');
});
