import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryHelperAgent } from '../src/agents/builtin-helper-agents.js';
import { createSillyTavernMemoryLifecycle } from '../src/integrations/sillytavern-memory-lifecycle.js';
import { createMemoryPersistence } from '../src/memory/memory-persistence.js';
import { createMemoryPipeline } from '../src/memory/memory-pipeline.js';
import { createMemoryStore } from '../src/memory/memory-store.js';
import { createSourceLedger } from '../src/memory/source-ledger.js';
import { MEMORY_TYPES } from '../src/memory/memory-types.js';

test('restores helper-generated memories with their source provenance after reload', async () => {
    const metadata = {};
    const sourceLedger = createSourceLedger();
    const store = createMemoryStore({ sourceLedger });
    const pipeline = createMemoryPipeline({ store, sourceLedger });
    pipeline.registerExtractor('helper', {
        async extract() {
            return { type: MEMORY_TYPES.ATOMIC, content: 'Elena carries the brass key.' };
        },
    });
    const helper = createMemoryHelperAgent({ pipeline, getActiveChatId: () => 'chat-a' });
    const persistence = createMemoryPersistence({
        store,
        sourceLedger,
        metadata,
        saveMetadata: async () => {},
        debounceMs: 1,
        clock: { now: () => 123 },
    });

    persistence.start('chat-a');
    const result = await helper.run({
        payload: {
            chatId: 'chat-a',
            extractors: ['helper'],
            input: 'Elena takes the key.',
            sources: [{
                chatId: 'chat-a',
                messageId: '42',
                messageIndex: 42,
                role: 'assistant',
                author: 'Elena',
                hash: 'source-hash',
            }],
        },
    });
    const [memory] = result.records;
    await persistence.flush();

    store.clear({ silent: true });
    const restored = persistence.load('chat-a');

    assert.equal(restored.length, 1);
    assert.deepEqual(restored[0].sourceIds, ['chat-a:42']);
    assert.equal(sourceLedger.getForMemory(memory.id)[0].hash, 'source-hash');
    assert.equal(metadata.nemolore.memory.schemaVersion, 2);
    assert.equal(metadata.nemolore.memory.sources.length, 1);
});

test('loads schema v1 source links through provenance recovery records', () => {
    const metadata = {
        nemolore: {
            memory: {
                schemaVersion: 1,
                chatId: 'chat-a',
                records: [{
                    id: 'memory-old',
                    type: MEMORY_TYPES.ATOMIC,
                    content: 'Legacy sourced memory.',
                    sourceIds: ['chat-a:7'],
                }],
            },
        },
    };
    const sourceLedger = createSourceLedger();
    const store = createMemoryStore({ sourceLedger });
    const persistence = createMemoryPersistence({
        store,
        sourceLedger,
        metadata,
        saveMetadata: async () => {},
    });

    const restored = persistence.load('chat-a');

    assert.equal(restored.length, 1);
    assert.equal(sourceLedger.get('chat-a:7').messageId, '7');
    assert.equal(sourceLedger.get('chat-a:7').metadata.recoveredFromMemorySchemaVersion, 1);
    assert.equal(sourceLedger.getForMemory('memory-old').length, 1);
});

test('logs a rejected initial activation instead of leaving an unhandled promise', async () => {
    const logged = [];
    const lifecycle = createSillyTavernMemoryLifecycle({
        eventSource: { on() {} },
        getChatId: () => 'chat-a',
        persistence: {
            start() { throw new Error('corrupt persisted memory'); },
            async flush() {},
        },
        logger: { error(...args) { logged.push(args); } },
    });

    assert.equal(lifecycle.install(), true);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], 'Initial chat memory activation failed.');
    assert.match(logged[0][1].message, /corrupt persisted memory/);
});
