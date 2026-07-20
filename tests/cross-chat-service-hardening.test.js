import test from 'node:test';
import assert from 'node:assert/strict';

import { createActiveChatGuard, isActiveChat } from '../src/core/active-chat-guard.js';
import { createChatMetadataAccessor } from '../src/core/chat-metadata-accessor.js';
import { createKeyedLock } from '../src/core/keyed-lock.js';
import { createSillyTavernMemoryLifecycle } from '../src/integrations/sillytavern-memory-lifecycle.js';
import { createLoreGenerationService } from '../src/lore/lore-generation-service.js';
import { createSummaryService } from '../src/summary/summary-service.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

test('chat metadata accessor follows SillyTavern metadata replacement', () => {
    let metadata = { chat: 'a' };
    const current = createChatMetadataAccessor({ getMetadata: () => metadata }, 'Test service');

    assert.equal(current().chat, 'a');
    metadata = { chat: 'b' };
    assert.equal(current().chat, 'b');

    metadata = null;
    assert.throws(() => current(), /Test service requires mutable chat metadata/);
});

test('active chat guards compare normalized ids and remain optional', () => {
    let activeChatId = 7;
    const guard = createActiveChatGuard(() => activeChatId, '7');

    assert.equal(guard(), true);
    activeChatId = '8';
    assert.equal(guard(), false);
    assert.equal(isActiveChat(undefined, 'anything'), true);
});

test('memory lifecycle serializes switches, rejects stale activation, and preserves semantic activation', async () => {
    let activeChatId = 'chat-a';
    const firstMigration = deferred();
    const calls = [];
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
                if (chatId === 'chat-a') await firstMigration.promise;
                return { migrated: 0 };
            },
        },
        async onActivated(chatId) { calls.push(`semantic:${chatId}`); },
    });

    const activateA = lifecycle.activate('chat-a');
    const duplicateA = lifecycle.activate('chat-a');
    const activateB = lifecycle.activate('chat-b');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['start:chat-a', 'migrate:chat-a']);

    activeChatId = 'chat-b';
    firstMigration.resolve();
    const [a, duplicate, b] = await Promise.all([activateA, duplicateA, activateB]);

    assert.equal(a.reason, 'stale-chat');
    assert.equal(duplicate.reason, 'stale-chat');
    assert.equal(b.skipped, false);
    assert.deepEqual(calls, [
        'start:chat-a',
        'migrate:chat-a',
        'start:chat-b',
        'migrate:chat-b',
        'semantic:chat-b',
    ]);
});

test('CHAT_LOADED forces memory and semantic reload for the active chat', async () => {
    const listeners = new Map();
    const starts = [];
    const semanticActivations = [];
    const lifecycle = createSillyTavernMemoryLifecycle({
        eventSource: { on(event, listener) { listeners.set(event, listener); } },
        chatChangedEvent: 'changed',
        chatLoadedEvent: 'loaded',
        getChatId: () => 'chat-a',
        persistence: {
            start(chatId) { starts.push(chatId); return []; },
            async flush() {},
        },
        migrator: { async migrate() { return { migrated: 0 }; } },
        onActivated: async chatId => semanticActivations.push(chatId),
    });

    lifecycle.install();
    await lifecycle.activate('chat-a');
    listeners.get('loaded')({ detail: { id: 4 } });
    await lifecycle.activate('chat-a');

    assert.deepEqual(starts, ['chat-a', 'chat-a']);
    assert.deepEqual(semanticActivations, ['chat-a', 'chat-a']);
});

test('summary generation cannot commit after the active chat changes', async () => {
    let activeChatId = 'chat-a';
    const gate = deferred();
    const started = deferred();
    const writes = [];
    const summary = createSummaryService({
        generation: {
            async generate() {
                started.resolve();
                return gate.promise;
            },
        },
        store: {
            get() { return null; },
            async save(chatId, value) { writes.push({ chatId, value }); return value; },
        },
        settings: {},
        getActiveChatId: () => activeChatId,
    });

    const pending = summary.summarize({
        chatId: 'chat-a',
        messages: [{ id: '1', mes: 'Chat A message.' }],
    });
    await started.promise;
    activeChatId = 'chat-b';
    gate.resolve({ text: 'Must not enter chat B.' });

    const result = await pending;
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'chat-changed');
    assert.deepEqual(writes, []);
});

test('summary service serializes concurrent generations for the same chat', async () => {
    const first = deferred();
    const started = [];
    const writes = [];
    const summary = createSummaryService({
        generation: {
            async generate({ prompt }) {
                started.push(prompt);
                if (started.length === 1) await first.promise;
                return { text: `Summary ${started.length}` };
            },
        },
        store: {
            get() { return null; },
            async save(chatId, value) { writes.push({ chatId, value }); return { ...value, metadata: value.metadata }; },
        },
        settings: {},
        getActiveChatId: () => 'chat-a',
    });

    const one = summary.summarize({ chatId: 'chat-a', messages: [{ id: '1', mes: 'One' }] });
    const two = summary.summarize({ chatId: 'chat-a', messages: [{ id: '2', mes: 'Two' }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started.length, 1);

    first.resolve();
    await Promise.all([one, two]);
    assert.equal(started.length, 2);
    assert.equal(writes.length, 2);
});

test('lore generation pins its lorebook and cannot write after a chat switch', async () => {
    let activeChatId = 'chat-a';
    const gate = deferred();
    const started = deferred();
    const loads = [];
    const writes = [];
    const lorebooks = {
        async ensureForChat(chatId) { return chatId === 'chat-a' ? 'Book A' : 'Book B'; },
        async load(name) { loads.push(name); return { entries: {} }; },
        async createEntry(value, name, { shouldCommit } = {}) {
            if (shouldCommit && !shouldCommit()) return null;
            writes.push({ value, name });
            return value;
        },
        async updateEntry() { throw new Error('Unexpected update.'); },
    };
    const lore = createLoreGenerationService({
        generation: {
            async generate() {
                started.resolve();
                return gate.promise;
            },
        },
        lorebooks,
        lock: createKeyedLock(),
        getActiveChatId: () => activeChatId,
    });

    const pending = lore.generate({ chatId: 'chat-a', input: 'Chat A text.' });
    await started.promise;
    activeChatId = 'chat-b';
    gate.resolve({ text: '{"entries":[{"key":"A","content":"Must not enter chat B."}]}' });

    const result = await pending;
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'chat-changed');
    assert.deepEqual(loads, ['Book A']);
    assert.deepEqual(writes, []);
});
