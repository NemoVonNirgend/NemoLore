import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/memory/memory-store.js';
import { createSourceLedger } from '../src/memory/source-ledger.js';
import {
    createNemoTavernMemoryMigrator,
    getNemoTavernStringHash,
} from '../src/memory/nemotavern-memory-migrator.js';

function makeHarness(chat) {
    let id = 0;
    let saves = 0;
    const metadata = {};
    const sourceLedger = createSourceLedger();
    const store = createMemoryStore({
        sourceLedger,
        recordOptions: {
            idFactory: () => `memory-${++id}`,
            now: () => '2026-07-20T00:00:00.000Z',
        },
    });
    const migrator = createNemoTavernMemoryMigrator({
        store,
        sourceLedger,
        metadata,
        getChat: () => chat,
        getActiveChatId: () => 'chat-a',
        saveMetadata: async () => { saves += 1; },
        clock: { now: () => 123 },
    });
    return { metadata, sourceLedger, store, migrator, saves: () => saves };
}

test('native migration imports valid chunks instead of their covered summaries and is a true no-op on rerun', async () => {
    const first = 'The party entered the ruins.';
    const second = 'Mara found a brass key.';
    const chat = [
        { id: 'm1', is_user: true, extra: { nemo_summary: first } },
        {
            id: 'm2',
            extra: {
                nemo_summary: second,
                nemo_chunk: {
                    text: 'The party entered the ruins, where Mara found a brass key.',
                    count: 2,
                    hash: getNemoTavernStringHash(`${first}\n${second}`),
                },
            },
        },
        { id: 'm3', extra: { nemo_summary: 'They returned to camp.' } },
    ];
    const harness = makeHarness(chat);

    const initial = await harness.migrator.migrate('chat-a');
    const marker = structuredClone(harness.metadata.nemolore.migrations.nativeNemoTavernMemory);
    const rerun = await harness.migrator.migrate('chat-a');

    assert.equal(initial.migrated, 2);
    assert.equal(harness.store.size, 2);
    assert.deepEqual(harness.store.list().map(record => record.metadata.nativeNemoTavern.kind), ['chapter-chunk', 'message-summary']);
    assert.ok(harness.store.list().every(record => record.sourceIds[0].startsWith('nemotavern:chat-a:')));
    assert.equal(rerun.migrated, 0);
    assert.equal(rerun.reason, 'already-migrated');
    assert.equal(harness.saves(), 1);
    assert.deepEqual(harness.metadata.nemolore.migrations.nativeNemoTavernMemory, marker);
    assert.equal(chat[1].extra.nemo_chunk.count, 2);

    delete chat[1].extra.nemo_chunk;
    const expanded = await harness.migrator.migrate('chat-a');
    assert.equal(expanded.invalidated, 1);
    assert.equal(harness.store.query().length, 3);
    assert.equal(harness.store.query({
        status: null,
        predicate: record => record.metadata.nativeNemoTavern.kind === 'chapter-chunk',
    })[0].status, 'invalidated');
});

test('native migration revises changed summaries and imports artifacts appended later', async () => {
    const chat = [{ id: 'stable-1', extra: { nemo_summary: 'Original summary.' } }];
    const harness = makeHarness(chat);
    await harness.migrator.migrate('chat-a');

    chat[0].extra.nemo_summary = 'Corrected summary.';
    const revised = await harness.migrator.migrate('chat-a');
    assert.equal(revised.updated, 1);
    assert.equal(harness.store.size, 1);
    assert.equal(harness.store.list()[0].content, 'Corrected summary.');
    assert.equal(harness.store.list()[0].revision, 2);

    chat.push({ id: 'stable-2', extra: { nemo_summary: 'A later event.' } });
    const appended = await harness.migrator.migrate('chat-a');
    assert.equal(appended.imported, 1);
    assert.equal(harness.store.size, 2);
    assert.equal(new Set(harness.store.list().map(record => record.metadata.nativeNemoTavern.sourceId)).size, 2);

    delete chat[0].extra.nemo_summary;
    const removed = await harness.migrator.migrate('chat-a');
    assert.equal(removed.invalidated, 1);
    const firstRecord = harness.store.list().find(record => record.metadata.nativeNemoTavern.messageId === 'stable-1');
    assert.equal(firstRecord.status, 'invalidated');

    chat[0].extra.nemo_summary = 'Restored summary.';
    const restored = await harness.migrator.migrate('chat-a');
    assert.equal(restored.updated, 1);
    assert.equal(harness.store.size, 2);
    assert.equal(harness.store.get(firstRecord.id).status, 'active');
    assert.equal(harness.store.get(firstRecord.id).content, 'Restored summary.');
});

test('native migration refuses a queued chat after the active chat has changed', async () => {
    const metadata = {};
    const store = createMemoryStore();
    const migrator = createNemoTavernMemoryMigrator({
        store,
        metadata,
        getChat: () => [{ id: 'b1', extra: { nemo_summary: 'Belongs to B.' } }],
        getActiveChatId: () => 'chat-b',
        saveMetadata: async () => assert.fail('stale migration must not save metadata'),
    });

    const result = await migrator.migrate('chat-a');
    assert.equal(result.reason, 'stale-chat');
    assert.equal(store.size, 0);
    assert.deepEqual(metadata, {});
});
