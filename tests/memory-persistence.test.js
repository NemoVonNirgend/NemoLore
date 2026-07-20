import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/memory/memory-store.js';
import { createMemoryPersistence } from '../src/memory/memory-persistence.js';
import { createLegacyMemoryMigrator } from '../src/memory/legacy-memory-migrator.js';
import { createSillyTavernMemoryLifecycle } from '../src/integrations/sillytavern-memory-lifecycle.js';
import { MEMORY_TYPES } from '../src/memory/memory-types.js';

function makeStore() {
    let id = 0;
    return createMemoryStore({
        recordOptions: {
            idFactory: () => `memory-${++id}`,
            now: () => '2026-07-19T00:00:00.000Z',
        },
    });
}

test('persists and restores memory records per chat', async () => {
    const metadata = {};
    let saves = 0;
    const store = makeStore();
    const persistence = createMemoryPersistence({
        store,
        metadata,
        saveMetadata: async () => { saves += 1; },
        debounceMs: 1,
        clock: { now: () => 123 },
    });

    persistence.start('chat-a');
    store.save({ type: MEMORY_TYPES.ATOMIC, content: 'Elena carries the brass key.' });
    await persistence.flush();
    assert.equal(metadata.nemolore.memory.records.length, 1);
    assert.equal(saves, 1);

    store.clear({ silent: true });
    const restored = persistence.load('chat-a');
    assert.equal(restored.length, 1);
    assert.equal(store.list()[0].content, 'Elena carries the brass key.');
});

test('debounces repeated writes without stranding the pending promise', async () => {
    const metadata = {};
    let saves = 0;
    const store = makeStore();
    const persistence = createMemoryPersistence({
        store,
        metadata,
        saveMetadata: async () => { saves += 1; },
        debounceMs: 5,
    });
    persistence.start('chat-a');

    store.save({ type: MEMORY_TYPES.ATOMIC, content: 'One.' });
    const first = persistence.schedule();
    store.save({ type: MEMORY_TYPES.ATOMIC, content: 'Two.' });
    const second = persistence.schedule();
    assert.equal(first, second);
    await second;
    assert.equal(saves, 1);
    assert.equal(metadata.nemolore.memory.records.length, 2);
});

test('migrates legacy summaries once and preserves the source data', async () => {
    const metadata = {};
    const settings = { chatSummaries: { 'chat-a': ['First arc summary', { summary: 'Second arc summary' }] } };
    const store = makeStore();
    const migrator = createLegacyMemoryMigrator({
        store,
        settings,
        metadata,
        saveMetadata: async () => {},
        clock: { now: () => 456 },
    });

    const first = await migrator.migrate('chat-a');
    const second = await migrator.migrate('chat-a');
    assert.equal(first.migrated, 2);
    assert.equal(second.reason, 'already-migrated');
    assert.equal(store.query({ type: MEMORY_TYPES.CONSOLIDATED }).length, 2);
    assert.deepEqual(settings.chatSummaries['chat-a'][0], 'First arc summary');
    assert.equal(metadata.nemolore.migrations.legacyChatSummaries.sourcePreserved, true);
});

test('flushes old chat memory before activating the next chat', async () => {
    const calls = [];
    const listeners = new Map();
    const lifecycle = createSillyTavernMemoryLifecycle({
        eventSource: {
            on(event, handler) { listeners.set(event, handler); },
            off(event) { listeners.delete(event); },
        },
        chatChangedEvent: 'changed',
        getChatId: () => 'chat-a',
        persistence: {
            start(chatId) { calls.push(`start:${chatId}`); return []; },
            async flush() { calls.push('flush'); },
            stop() {},
        },
        migrator: { async migrate() { return { migrated: 0 }; } },
    });

    await lifecycle.activate('chat-a');
    await lifecycle.activate('chat-b');
    assert.deepEqual(calls, ['start:chat-a', 'flush', 'start:chat-b']);
});
