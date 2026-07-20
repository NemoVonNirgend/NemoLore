import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryHelperAgent } from '../src/agents/builtin-helper-agents.js';
import { createLorebookRepository } from '../src/lore/lorebook-repository.js';
import { createLegacyMemoryMigrator } from '../src/memory/legacy-memory-migrator.js';
import { createMemoryPersistence } from '../src/memory/memory-persistence.js';
import { createMemoryPipeline } from '../src/memory/memory-pipeline.js';
import { createSourceLedger } from '../src/memory/source-ledger.js';
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

test('memory persistence flushes to the metadata object captured for its active chat', async () => {
    const metadata = { a: {}, b: {} };
    let currentMetadata = metadata.a;
    let records = [];
    const store = {
        exportRecords: () => structuredClone(records),
        importRecords(value) { records = structuredClone(value); return records; },
        clear() { records = []; },
        subscribe() { return () => {}; },
    };
    const persistence = createMemoryPersistence({
        store,
        getMetadata: () => currentMetadata,
        saveMetadata: async () => {},
        clock: { now: () => 50 },
    });

    persistence.start('chat-a');
    records = [{ id: 'memory-a', sourceIds: [] }];
    currentMetadata = metadata.b;
    await persistence.flush();

    assert.equal(metadata.a.nemolore.memory.chatId, 'chat-a');
    assert.equal(metadata.a.nemolore.memory.records[0].id, 'memory-a');
    assert.equal(metadata.b.nemolore, undefined);

    persistence.start('chat-b');
    records = [{ id: 'memory-b', sourceIds: [] }];
    await persistence.flush();
    assert.equal(metadata.b.nemolore.memory.chatId, 'chat-b');
    persistence.stop();
});

test('summary store follows the live chat metadata object', async () => {
    const metadata = { a: {}, b: {} };
    let currentMetadata = metadata.a;
    const store = createSummaryStore({
        getMetadata: () => currentMetadata,
        saveMetadata: async () => {},
        clock: { now: () => 25 },
    });

    await store.save('chat-a', { text: 'Summary A' });
    currentMetadata = metadata.b;
    assert.equal(store.get('chat-a'), null);
    await store.save('chat-b', { text: 'Summary B' });

    assert.equal(metadata.a.nemolore.summaries['chat-a'].text, 'Summary A');
    assert.equal(metadata.b.nemolore.summaries['chat-b'].text, 'Summary B');
});

test('late lorebook creation is removed instead of being associated with the next chat', async () => {
    let activeChatId = 'chat-a';
    const metadata = { a: {}, b: {} };
    let currentMetadata = metadata.a;
    const creation = deferred();
    const started = deferred();
    const removed = [];
    const repository = createLorebookRepository({
        adapter: {
            async create() {
                started.resolve();
                await creation.promise;
            },
            async remove(name) { removed.push(name); },
        },
        getMetadata: () => currentMetadata,
        saveMetadata: async () => {},
        metadataKey: 'world_info',
        state: { raw: { lifecycle: { currentChatLorebook: null } } },
        getActiveChatId: () => activeChatId,
        clock: { now: () => 50 },
    });

    const pending = repository.ensureForChat('chat-a');
    await started.promise;
    activeChatId = 'chat-b';
    currentMetadata = metadata.b;
    creation.resolve();

    assert.equal(await pending, null);
    assert.equal(metadata.a.world_info, undefined);
    assert.equal(metadata.b.world_info, undefined);
    assert.deepEqual(removed, ['_NemoLore_chat-a_50']);
});

test('legacy migration follows live metadata and rejects stale chat requests', async () => {
    const metadata = { a: {}, b: {} };
    let currentMetadata = metadata.a;
    let activeChatId = 'chat-a';
    const records = [];
    const migrator = createLegacyMemoryMigrator({
        store: {
            save(value) { records.push(value); return value; },
            query() { return []; },
        },
        settings: { chatSummaries: { 'chat-a': 'Summary A', 'chat-b': 'Summary B' } },
        getMetadata: () => currentMetadata,
        getActiveChatId: () => activeChatId,
        saveMetadata: async () => {},
        clock: { now: () => 75 },
    });

    const a = await migrator.migrate('chat-a');
    activeChatId = 'chat-b';
    currentMetadata = metadata.b;
    const stale = await migrator.migrate('chat-a');
    const b = await migrator.migrate('chat-b');

    assert.equal(a.migrated, 1);
    assert.equal(stale.reason, 'stale-chat');
    assert.equal(b.migrated, 1);
    assert.equal(metadata.a.nemolore.migrations.legacyChatSummaries.chatId, 'chat-a');
    assert.equal(metadata.b.nemolore.migrations.legacyChatSummaries.chatId, 'chat-b');
    assert.equal(records.length, 2);
});

test('memory helper and pipeline discard extraction that resolves after a chat switch', async () => {
    let activeChatId = 'chat-a';
    const extraction = deferred();
    const started = deferred();
    const saved = [];
    let maintenanceRuns = 0;
    const sourceLedger = createSourceLedger();
    const pipeline = createMemoryPipeline({
        store: {
            save(value) {
                const record = { id: `memory-${saved.length + 1}`, ...value };
                saved.push(record);
                return record;
            },
            has() { return false; },
        },
        sourceLedger,
    });
    pipeline.registerExtractor('held', {
        async extract() {
            started.resolve();
            return extraction.promise;
        },
    });
    const helper = createMemoryHelperAgent({
        pipeline,
        maintenance: { async run() { maintenanceRuns += 1; return {}; } },
        getActiveChatId: () => activeChatId,
    });

    const pending = helper.run({
        payload: {
            chatId: 'chat-a',
            extractors: ['held'],
            input: 'Late memory',
            sources: [{ chatId: 'chat-a', messageId: '1' }],
        },
    });
    await started.promise;
    activeChatId = 'chat-b';
    extraction.resolve({ content: 'Must not enter chat B.' });

    const result = await pending;
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'chat-changed');
    assert.deepEqual(saved, []);
    assert.equal(maintenanceRuns, 0);
});
