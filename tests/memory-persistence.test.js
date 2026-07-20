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

test('persistence follows SillyTavern when chat metadata is replaced', async () => {
    const metadataByChat = {
        'chat-a': {},
        'chat-b': {},
    };
    let activeMetadata = metadataByChat['chat-a'];
    const store = makeStore();
    const persistence = createMemoryPersistence({
        store,
        getMetadata: () => activeMetadata,
        saveMetadata: async () => {},
        debounceMs: 1,
        clock: { now: () => 123 },
    });

    persistence.start('chat-a');
    store.save({ type: MEMORY_TYPES.ATOMIC, content: 'Memory for A.' });
    await persistence.flush();

    store.save({ type: MEMORY_TYPES.ATOMIC, content: 'Late memory for A.' });
    activeMetadata = metadataByChat['chat-b'];
    await persistence.flush();
    assert.equal(metadataByChat['chat-a'].nemolore.memory.records.length, 2);
    assert.equal(metadataByChat['chat-b'].nemolore, undefined);

    persistence.start('chat-b');
    store.save({ type: MEMORY_TYPES.ATOMIC, content: 'Memory for B.' });
    await persistence.flush();

    assert.equal(metadataByChat['chat-a'].nemolore.memory.chatId, 'chat-a');
    assert.equal(metadataByChat['chat-a'].nemolore.memory.records[0].content, 'Memory for A.');
    assert.equal(metadataByChat['chat-b'].nemolore.memory.chatId, 'chat-b');
    assert.equal(metadataByChat['chat-b'].nemolore.memory.records[0].content, 'Memory for B.');
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

test('legacy migration writes its marker to the current chat metadata', async () => {
    const metadataByChat = { 'chat-a': {}, 'chat-b': {} };
    let activeMetadata = metadataByChat['chat-a'];
    const migrator = createLegacyMemoryMigrator({
        store: makeStore(),
        settings: { chatSummaries: { 'chat-a': 'Summary A', 'chat-b': 'Summary B' } },
        getMetadata: () => activeMetadata,
        saveMetadata: async () => {},
        clock: { now: () => 456 },
    });

    await migrator.migrate('chat-a');
    activeMetadata = metadataByChat['chat-b'];
    await migrator.migrate('chat-b');

    assert.equal(metadataByChat['chat-a'].nemolore.migrations.legacyChatSummaries.chatId, 'chat-a');
    assert.equal(metadataByChat['chat-b'].nemolore.migrations.legacyChatSummaries.chatId, 'chat-b');
});

test('flushes old chat memory before activating the next chat', async () => {
    const calls = [];
    const listeners = new Map();
    let activeChatId = 'chat-a';
    const lifecycle = createSillyTavernMemoryLifecycle({
        eventSource: {
            on(event, handler) { listeners.set(event, handler); },
            off(event) { listeners.delete(event); },
        },
        chatChangedEvent: 'changed',
        getChatId: () => activeChatId,
        persistence: {
            start(chatId) { calls.push(`start:${chatId}`); return []; },
            async flush() { calls.push('flush'); },
            stop() {},
        },
        migrator: { async migrate() { return { migrated: 0 }; } },
    });

    await lifecycle.activate('chat-a');
    activeChatId = 'chat-b';
    await lifecycle.activate('chat-b');
    assert.deepEqual(calls, ['start:chat-a', 'flush', 'start:chat-b']);
});

test('serializes chat activation and skips duplicate SillyTavern events', async () => {
    const calls = [];
    let releaseFirstMigration;
    let activeChatId = 'chat-a';
    const firstMigration = new Promise(resolve => { releaseFirstMigration = resolve; });
    const lifecycle = createSillyTavernMemoryLifecycle({
        eventSource: { on() {} },
        getChatId: () => activeChatId,
        persistence: {
            start(chatId) { calls.push(`start:${chatId}`); return []; },
            async flush() { calls.push('flush'); },
        },
        migrator: {
            async migrate(chatId) {
                calls.push(`migrate:${chatId}`);
                if (chatId === 'chat-a') await firstMigration;
                return { migrated: 0 };
            },
        },
    });

    const activateA = lifecycle.activate('chat-a');
    const duplicateA = lifecycle.activate('chat-a');
    const activateB = lifecycle.activate('chat-b');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['start:chat-a', 'migrate:chat-a']);

    activeChatId = 'chat-b';
    releaseFirstMigration();
    const [, duplicateResult] = await Promise.all([activateA, duplicateA, activateB]);
    assert.equal(duplicateResult.reason, 'stale-chat');
    assert.deepEqual(calls, [
        'start:chat-a',
        'migrate:chat-a',
        'start:chat-b',
        'migrate:chat-b',
    ]);
});

test('resolves object-shaped CHAT_LOADED payloads through getChatId', async () => {
    const listeners = new Map();
    const starts = [];
    let currentChatId = 'chat-a';
    const lifecycle = createSillyTavernMemoryLifecycle({
        eventSource: {
            on(event, handler) { listeners.set(event, handler); },
        },
        chatLoadedEvent: 'loaded',
        getChatId: () => currentChatId,
        persistence: {
            start(chatId) { starts.push(chatId); return []; },
            async flush() {},
        },
        migrator: { async migrate() { return { migrated: 0 }; } },
    });

    lifecycle.install();
    await lifecycle.activate('chat-a');
    currentChatId = 'chat-b';
    listeners.get('loaded')({ detail: { id: 4 } });
    await lifecycle.activate('chat-b');

    assert.deepEqual(starts, ['chat-a', 'chat-b']);
    assert.equal(starts.includes('[object Object]'), false);
});

test('reloads persisted memory when CHAT_LOADED repeats the active chat id', async () => {
    const listeners = new Map();
    const starts = [];
    const lifecycle = createSillyTavernMemoryLifecycle({
        eventSource: {
            on(event, handler) { listeners.set(event, handler); },
        },
        chatChangedEvent: 'changed',
        chatLoadedEvent: 'loaded',
        getChatId: () => 'chat-a',
        persistence: {
            start(chatId) { starts.push(chatId); return []; },
            async flush() {},
        },
        migrator: { async migrate() { return { migrated: 0 }; } },
    });

    lifecycle.install();
    await lifecycle.activate('chat-a');
    assert.deepEqual(starts, ['chat-a']);

    listeners.get('loaded')({ detail: { id: 4 } });
    await lifecycle.activate('chat-a');

    assert.deepEqual(starts, ['chat-a', 'chat-a']);
});

test('detached debounced persistence logs failures without unhandled rejections', async () => {
    const failure = new Error('metadata write failed');
    const errors = [];
    const unhandled = [];
    const onUnhandled = reason => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);

    const store = makeStore();
    const persistence = createMemoryPersistence({
        store,
        metadata: {},
        saveMetadata: async () => { throw failure; },
        debounceMs: 1,
        logger: {
            error(message, error) { errors.push({ message, error }); },
        },
    });

    try {
        persistence.start('chat-a');
        store.save({ type: MEMORY_TYPES.ATOMIC, content: 'Will fail to persist.' });
        await new Promise(resolve => setTimeout(resolve, 20));
        await new Promise(resolve => setImmediate(resolve));

        assert.deepEqual(unhandled, []);
        assert.equal(errors.length, 1);
        assert.match(errors[0].message, /persistence failed/i);
        assert.equal(errors[0].error, failure);

        const explicit = persistence.schedule();
        await assert.rejects(explicit, /metadata write failed/);
        assert.equal(errors.length, 2);
        await assert.rejects(persistence.flush(), /metadata write failed/);
    } finally {
        persistence.stop();
        process.off('unhandledRejection', onUnhandled);
    }
});
