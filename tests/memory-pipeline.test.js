import test from 'node:test';
import assert from 'node:assert/strict';

import { MEMORY_STATUS, MEMORY_TYPES } from '../src/memory/memory-types.js';
import { createMemoryStore } from '../src/memory/memory-store.js';
import { createMemoryPipeline } from '../src/memory/memory-pipeline.js';
import { createSourceLedger } from '../src/memory/source-ledger.js';

function createFixture() {
    let id = 0;
    let timestamp = 0;
    const sourceLedger = createSourceLedger();
    const store = createMemoryStore({
        sourceLedger,
        recordOptions: {
            idFactory: () => `memory-${++id}`,
            now: () => `2026-01-01T00:00:0${timestamp++}.000Z`,
        },
    });
    const pipeline = createMemoryPipeline({ store, sourceLedger });
    return { sourceLedger, store, pipeline };
}

test('ingests source-linked memories through a named extractor', async () => {
    const { sourceLedger, store, pipeline } = createFixture();

    pipeline.registerExtractor('episode', {
        async extract({ input }) {
            return {
                type: MEMORY_TYPES.EPISODE,
                title: 'Station confrontation',
                content: input,
                entityIds: ['marcus', 'elena'],
                tags: ['unresolved'],
                importance: 0.8,
            };
        },
    });

    const [memory] = await pipeline.ingest({
        extractor: 'episode',
        input: 'Marcus promised to return before dawn.',
        sources: [{ chatId: 'chat-1', messageId: '42', role: 'assistant' }],
    });

    assert.equal(memory.id, 'memory-1');
    assert.deepEqual(memory.sourceIds, ['chat-1:42']);
    assert.equal(sourceLedger.getForMemory(memory.id)[0].role, 'assistant');
    assert.deepEqual(store.query({ entityId: 'marcus' }).map(item => item.id), ['memory-1']);
    assert.deepEqual(store.query({ tag: 'unresolved' }).map(item => item.id), ['memory-1']);
});

test('revisions preserve identity and increment revision number', () => {
    const { sourceLedger, store } = createFixture();
    sourceLedger.register({ chatId: 'chat-1', messageId: '8' });

    const original = store.save({
        type: MEMORY_TYPES.ATOMIC,
        content: 'Elena carries the brass key.',
        sourceIds: ['chat-1:8'],
    });
    const revised = store.update(original.id, {
        content: 'Elena hid the brass key beneath her coat.',
        confidence: 0.9,
    });

    assert.equal(revised.id, original.id);
    assert.equal(revised.revision, 2);
    assert.equal(revised.createdAt, original.createdAt);
    assert.equal(revised.confidence, 0.9);
});

test('invalidating a source invalidates linked memories', async () => {
    const { store, pipeline } = createFixture();
    pipeline.registerExtractor('fact', {
        extract() {
            return {
                type: MEMORY_TYPES.ATOMIC,
                content: 'The northern gate is sealed.',
            };
        },
    });

    const [memory] = await pipeline.ingest({
        extractor: 'fact',
        sources: [{ chatId: 'chat-2', messageId: '3' }],
    });

    const affected = pipeline.invalidateSource('chat-2:3', 'message-edited');
    assert.deepEqual(affected, [memory.id]);
    assert.equal(store.get(memory.id).status, MEMORY_STATUS.INVALIDATED);
    assert.deepEqual(store.query(), []);
    assert.deepEqual(
        store.query({ status: MEMORY_STATUS.INVALIDATED }).map(item => item.id),
        [memory.id],
    );
});

test('processors can enrich or reject candidates before storage', async () => {
    const { store, pipeline } = createFixture();
    pipeline.registerExtractor('mixed', {
        extract() {
            return [
                { type: MEMORY_TYPES.ATOMIC, content: 'Keep me', importance: 0.2 },
                { type: MEMORY_TYPES.ATOMIC, content: 'Discard me', importance: 0.1 },
            ];
        },
    });
    pipeline.registerProcessor(candidate => {
        if (candidate.content === 'Discard me') return null;
        return { ...candidate, tags: ['processed'], importance: 0.7 };
    });

    const saved = await pipeline.ingest({
        extractor: 'mixed',
        sources: [{ chatId: 'chat-3', messageId: '1' }],
    });

    assert.equal(saved.length, 1);
    assert.equal(saved[0].importance, 0.7);
    assert.deepEqual(store.query({ tag: 'processed' }).map(item => item.content), ['Keep me']);
});
