import test from 'node:test';
import assert from 'node:assert/strict';

import { createContextInjector } from '../src/context/context-injector.js';
import { createContextRegistry } from '../src/context/context-registry.js';
import { createMemoryContextContributor } from '../src/context/contributors/memory-context-contributor.js';
import { createSillyTavernMemoryLifecycle } from '../src/integrations/sillytavern-memory-lifecycle.js';

function contributor(output) {
    return { async contribute() { return output; } };
}

test('context injector orders contributors and respects token budget', async () => {
    const registry = createContextRegistry();
    registry.register('low', contributor({
        id: 'low', content: 'low context', priority: 10, estimatedTokens: 5,
    }));
    registry.register('high', contributor({
        id: 'high', content: 'high context', priority: 100, estimatedTokens: 7,
    }));
    registry.register('required', contributor({
        id: 'required', content: 'required context', priority: 0, estimatedTokens: 8, required: true,
    }));

    const injector = createContextInjector({ registry });
    const result = await injector.inject({}, { maxTokens: 15 });

    assert.deepEqual(result.selected.map(item => item.id), ['required', 'high']);
    assert.equal(result.omitted[0].id, 'low');
    assert.equal(result.omitted[0].omissionReason, 'token-budget');
    assert.match(result.text, /required context/);
    assert.match(result.text, /high context/);
});

test('context injector isolates contributor failures', async () => {
    const registry = createContextRegistry();
    registry.register('broken', {
        async contribute() { throw new Error('boom'); },
    });
    registry.register('healthy', contributor({ id: 'healthy', content: 'still works' }));

    const injector = createContextInjector({ registry });
    const result = await injector.inject();

    assert.equal(result.errors.length, 1);
    assert.equal(result.selected.length, 1);
    assert.equal(result.selected[0].id, 'healthy');
});

test('memory contributor converts retrieval output into a context contribution', async () => {
    const retrieval = {
        retrieve() {
            return {
                text: '## Relevant Memory\n\n- Marcus made a promise.',
                selected: [{ record: { id: 'memory-1' }, score: 0.8, components: { entity: 0.3 } }],
                omitted: [],
                memoryIds: ['memory-1'],
                groups: { atomic: 1 },
                usedTokens: 20,
            };
        },
    };

    const memory = createMemoryContextContributor({ retrieval });
    const output = await memory.contribute({ text: 'Marcus returns.' });

    assert.equal(output.id, 'memory:retrieved');
    assert.equal(output.estimatedTokens, 20);
    assert.deepEqual(output.metadata.selectedIds, ['memory-1']);
    assert.match(output.content, /Marcus made a promise/);
});

test('memory contributor waits for persistence activation before retrieving the next chat', async () => {
    let releaseFlush;
    let markFlushStarted;
    const flushStarted = new Promise(resolve => { markFlushStarted = resolve; });
    const heldFlush = new Promise(resolve => { releaseFlush = resolve; });
    const persistence = {
        activeChatId: null,
        start(chatId) {
            this.activeChatId = chatId;
            return [];
        },
        async flush() {
            markFlushStarted();
            await heldFlush;
        },
    };
    const lifecycle = createSillyTavernMemoryLifecycle({
        eventSource: { on() {} },
        persistence,
        migrator: { async migrate() { return { migrated: 0 }; } },
    });
    await lifecycle.activate('chat-a');

    let retrievals = 0;
    const memory = createMemoryContextContributor({
        persistence,
        retrieval: {
            retrieve() {
                retrievals += 1;
                return {
                    text: 'Memory for the active chat.',
                    selected: [],
                    omitted: [],
                    memoryIds: [],
                    groups: {},
                    usedTokens: 6,
                };
            },
        },
    });

    const activatingB = lifecycle.activate('chat-b');
    await flushStarted;
    assert.equal(persistence.activeChatId, 'chat-a');
    assert.deepEqual(await memory.contribute({ chatId: 'chat-b' }), []);
    assert.equal(retrievals, 0);

    releaseFlush();
    await activatingB;
    const contribution = await memory.contribute({ chatId: 'chat-b' });
    assert.equal(contribution.content, 'Memory for the active chat.');
    assert.equal(retrievals, 1);
});
