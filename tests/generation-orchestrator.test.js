import test from 'node:test';
import assert from 'node:assert/strict';
import { createSillyTavernGenerationOrchestrator } from '../src/integrations/sillytavern-generation-orchestrator.js';

test('refreshes context, awaits foreground generation, then dispatches helper work', async () => {
    const order = [];
    const orchestrator = createSillyTavernGenerationOrchestrator({
        contextBridge: { async refresh() { order.push('context'); } },
        requestFactory: async () => ({ contextRequest: { text: 'hello' }, postReply: { input: 'scene' } }),
        next: async () => { order.push('foreground'); return 'reply'; },
        postReply: { dispatch(payload) { order.push('helper'); assert.equal(payload.foregroundResult, 'reply'); } },
    });

    const result = await orchestrator([], 8000, null, 'normal');
    assert.equal(result, 'reply');
    assert.deepEqual(order, ['context', 'foreground', 'helper']);
});

test('context failures do not block foreground generation by default', async () => {
    let generated = false;
    const orchestrator = createSillyTavernGenerationOrchestrator({
        contextBridge: { async refresh() { throw new Error('retrieval failed'); } },
        requestFactory: async () => ({}),
        next: async () => { generated = true; return 'reply'; },
        postReply: { dispatch() {} },
        logger: { error() {} },
    });

    assert.equal(await orchestrator([], 8000, null, 'normal'), 'reply');
    assert.equal(generated, true);
});
