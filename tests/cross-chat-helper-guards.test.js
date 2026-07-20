import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryHelperAgent } from '../src/agents/builtin-helper-agents.js';
import { createKeyedLock } from '../src/core/keyed-lock.js';
import { createLoreGenerationService } from '../src/lore/lore-generation-service.js';
import { createLorebookRepository } from '../src/lore/lorebook-repository.js';
import { createMemoryPipeline } from '../src/memory/memory-pipeline.js';
import { createMemoryStore } from '../src/memory/memory-store.js';
import { MEMORY_TYPES } from '../src/memory/memory-types.js';
import { createSourceLedger } from '../src/memory/source-ledger.js';
import { createSummaryService } from '../src/summary/summary-service.js';
import { createSummaryStore } from '../src/summary/summary-store.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createState() {
    return { raw: { lifecycle: { currentChatLorebook: null } } };
}

test('memory helper discards extraction that resolves after the active chat changes', async () => {
    let activeChatId = 'chat-a';
    const gate = deferred();
    const started = deferred();
    const sourceLedger = createSourceLedger();
    const store = createMemoryStore({ sourceLedger });
    const pipeline = createMemoryPipeline({ store, sourceLedger });
    pipeline.registerExtractor('held-provider', {
        async extract() {
            started.resolve();
            return gate.promise;
        },
    });
    const helper = createMemoryHelperAgent({
        pipeline,
        getActiveChatId: () => activeChatId,
    });

    const pending = helper.run({
        payload: {
            chatId: 'chat-a',
            extractors: ['held-provider'],
            input: 'A late memory.',
            sources: [{ chatId: 'chat-a', messageId: '1' }],
        },
    });
    await started.promise;
    activeChatId = 'chat-b';
    gate.resolve({ type: MEMORY_TYPES.ATOMIC, content: 'Must not enter chat B.' });

    const result = await pending;
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'chat-changed');
    assert.equal(store.size, 0);

    pipeline.registerExtractor('immediate', {
        extract: async () => ({ type: MEMORY_TYPES.ATOMIC, content: 'Belongs to chat B.' }),
    });
    const normal = await helper.run({
        payload: {
            chatId: 'chat-b',
            extractors: ['immediate'],
            sources: [{ chatId: 'chat-b', messageId: '2' }],
        },
    });
    assert.equal(normal.records.length, 1);
    assert.equal(store.list()[0].content, 'Belongs to chat B.');
});

test('summary helper discards generation that resolves after the active chat changes', async () => {
    let activeChatId = 'chat-a';
    const metadata = { a: {}, b: {} };
    let activeMetadata = metadata.a;
    const gate = deferred();
    const started = deferred();
    let held = true;
    const generation = {
        async generate() {
            if (!held) return { text: 'Summary B' };
            started.resolve();
            return gate.promise;
        },
    };
    const store = createSummaryStore({
        getMetadata: () => activeMetadata,
        saveMetadata: async () => {},
    });
    const summary = createSummaryService({
        generation,
        store,
        settings: {},
        getActiveChatId: () => activeChatId,
    });

    const pending = summary.summarize({
        chatId: 'chat-a',
        messages: [{ id: '1', mes: 'Chat A message.' }],
    });
    await started.promise;
    activeChatId = 'chat-b';
    activeMetadata = metadata.b;
    gate.resolve({ text: 'Must not enter chat B.' });

    const result = await pending;
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'chat-changed');
    assert.equal(metadata.a.nemolore?.summaries?.['chat-a'], undefined);
    assert.equal(metadata.b.nemolore?.summaries?.['chat-a'], undefined);

    held = false;
    const normal = await summary.summarize({
        chatId: 'chat-b',
        messages: [{ id: '2', mes: 'Chat B message.' }],
    });
    assert.equal(normal.skipped, false);
    assert.equal(store.get('chat-b').text, 'Summary B');
});

test('lore helper discards generation that resolves after the active chat changes', async () => {
    let activeChatId = 'chat-a';
    const gate = deferred();
    const started = deferred();
    let held = true;
    const books = {
        'Book A': { entries: {} },
        'Book B': { entries: {} },
    };
    const associations = { 'chat-a': 'Book A', 'chat-b': 'Book B' };
    const writes = [];
    const lorebooks = {
        async ensureForChat(chatId) { return associations[chatId]; },
        async load(name) { return structuredClone(books[name]); },
        async createEntry(value, name, { shouldCommit } = {}) {
            if (shouldCommit && !shouldCommit()) return null;
            writes.push({ name, value });
            const uid = Object.keys(books[name].entries).length + 1;
            books[name].entries[uid] = { uid, ...value };
            return books[name].entries[uid];
        },
        async updateEntry() { throw new Error('Unexpected update.'); },
    };
    const generation = {
        async generate() {
            if (!held) {
                return { text: '{"entries":[{"key":"B","content":"Belongs to chat B."}]}' };
            }
            started.resolve();
            return gate.promise;
        },
    };
    const lore = createLoreGenerationService({
        generation,
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
    assert.equal(writes.length, 0);
    assert.deepEqual(books['Book B'].entries, {});

    held = false;
    const normal = await lore.generate({ chatId: 'chat-b', input: 'Chat B text.' });
    assert.equal(normal.skipped, undefined);
    assert.equal(normal.applied.length, 1);
    assert.equal(writes[0].name, 'Book B');
});

test('lorebook creation does not associate a late-created book with the next chat', async () => {
    let activeChatId = 'chat-a';
    const metadata = { a: {}, b: {} };
    let activeMetadata = metadata.a;
    const gate = deferred();
    const started = deferred();
    const removed = [];
    const repository = createLorebookRepository({
        adapter: {
            async create() {
                started.resolve();
                await gate.promise;
            },
            async remove(name) { removed.push(name); },
        },
        getMetadata: () => activeMetadata,
        saveMetadata: async () => {},
        metadataKey: 'world_info',
        state: createState(),
        getActiveChatId: () => activeChatId,
        clock: { now: () => 50 },
    });

    const pending = repository.ensureForChat('chat-a');
    await started.promise;
    activeChatId = 'chat-b';
    activeMetadata = metadata.b;
    gate.resolve();

    assert.equal(await pending, null);
    assert.equal(metadata.b.world_info, undefined);
    assert.deepEqual(removed, ['_NemoLore_chat-a_50']);
});
