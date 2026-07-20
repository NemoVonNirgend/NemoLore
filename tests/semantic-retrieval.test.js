import test from 'node:test';
import assert from 'node:assert/strict';

import { createSillyTavernVectorAdapter } from '../src/integrations/sillytavern-vector-adapter.js';
import { createSemanticMemoryIndex } from '../src/memory/retrieval/semantic-memory-index.js';
import { createMemoryStore } from '../src/memory/memory-store.js';
import { createSourceLedger } from '../src/memory/source-ledger.js';
import { MEMORY_STATUS, MEMORY_TYPES } from '../src/memory/memory-types.js';

function response(value = null) {
    return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        async json() { return value; },
    };
}

test('SillyTavern vector adapter inherits built-in source and model settings', async () => {
    const calls = [];
    const adapter = createSillyTavernVectorAdapter({
        fetchImpl: async (path, options) => { calls.push([path, JSON.parse(options.body)]); return response([]); },
        getRequestHeaders: () => ({ 'Content-Type': 'application/json', Authorization: 'host-secret' }),
        getVectorSettings: () => ({ source: 'openai', openai_model: 'text-embedding-3-small' }),
    });
    await adapter.list('nemolore_chat');
    assert.equal(calls[0][0], '/api/vector/list');
    assert.equal(calls[0][1].source, 'openai');
    assert.equal(calls[0][1].model, 'text-embedding-3-small');
    assert.equal(calls[0][1].collectionId, 'nemolore_chat');
});

test('semantic index synchronizes active memories and maps query hashes back to ids', async () => {
    const sourceLedger = createSourceLedger();
    const store = createMemoryStore({ sourceLedger, recordOptions: { idFactory: () => 'memory-one' } });
    const record = store.save({ type: MEMORY_TYPES.ATOMIC, content: 'Mara concealed the moonstone.' });
    let saved = [];
    const adapter = {
        available: () => true,
        async list() { return saved.map(item => item.hash); },
        async insert(_collection, items) { saved.push(...items); },
        async remove(_collection, hashes) { saved = saved.filter(item => !hashes.includes(item.hash)); },
        async query() { return { hashes: [saved[0].hash], metadata: [{ similarity: 0.91 }] }; },
    };
    const index = createSemanticMemoryIndex({ store, adapter, settings: { enableVectorization: true } });
    index.start();
    const sync = await index.activate('chat');
    assert.equal(sync.inserted, 1);
    const matches = await index.query('hidden jewel', { topK: 3, threshold: 0.7 });
    assert.equal(matches.get(record.id), 0.91);

    store.update(record.id, { status: MEMORY_STATUS.ARCHIVED });
    await index.scheduleSync();
    assert.equal(saved.length, 0);
});

test('semantic index degrades to no matches when vector queries fail', async () => {
    const store = createMemoryStore();
    store.save({ type: MEMORY_TYPES.EPISODE, content: 'A remembered scene.' });
    const adapter = {
        available: () => true,
        async list() { return []; },
        async insert() {},
        async remove() {},
        async query() { throw new Error('backend unavailable'); },
    };
    const index = createSemanticMemoryIndex({ store, adapter, settings: { enableVectorization: true } });
    await index.activate('chat');
    assert.deepEqual(await index.query('scene'), new Map());
    assert.match(index.inspect().lastError, /backend unavailable/);
});

test('semantic index reports status and can rebuild its complete collection', async () => {
    const store = createMemoryStore({ recordOptions: { idFactory: () => 'memory-rebuild' } });
    store.save({ type: MEMORY_TYPES.ATOMIC, content: 'The observatory key is beneath the fountain.' });
    const calls = { removed: [], inserted: [] };
    const adapter = {
        available: () => true,
        inspect: () => ({ available: true, source: 'openai', model: 'embedding-model' }),
        async list() { return [12345]; },
        async insert(_collection, items) { calls.inserted.push(...items); },
        async remove(_collection, hashes) { calls.removed.push(...hashes); },
        async query() { return { hashes: [] }; },
    };
    const index = createSemanticMemoryIndex({ store, adapter, settings: { enableVectorization: true } });
    await index.activate('chat');
    const result = await index.rebuild();
    const status = index.inspect();

    assert.equal(result.rebuild, true);
    assert.deepEqual(calls.removed, [12345, 12345]);
    assert.equal(calls.inserted.at(-1).text.includes('observatory key'), true);
    assert.equal(status.source, 'openai');
    assert.equal(status.model, 'embedding-model');
    assert.equal(status.indexedCount, 1);
    assert.equal(status.lastError, null);
});
