import test from 'node:test';
import assert from 'node:assert/strict';

import { createSillyTavernProvider } from '../src/providers/sillytavern-provider.js';

test('SillyTavern provider maps normalized messages to raw generation', async () => {
    let captured;
    const provider = createSillyTavernProvider({
        async generate(options) {
            captured = options;
            return 'prefill generated response';
        },
    });

    const result = await provider.generate({
        messages: [
            { role: 'system', content: 'Keep continuity.' },
            { role: 'user', content: 'Summarize this.' },
        ],
        model: 'active-model',
        maxTokens: 200,
        temperature: 0.3,
        stop: ['END'],
        prefill: 'prefill ',
        metadata: { task: 'summary' },
    });

    assert.equal(captured.prompt, 'SYSTEM:\nKeep continuity.\n\nUSER:\nSummarize this.');
    assert.equal(captured.maxTokens, 200);
    assert.equal(captured.prefill, 'prefill ');
    assert.deepEqual(captured.metadata, { task: 'summary' });
    assert.equal(result.text, 'generated response');
    assert.equal(result.model, 'active-model');
});

test('SillyTavern provider rejects unsupported generation output', async () => {
    const provider = createSillyTavernProvider({ generate: async () => ({}) });
    await assert.rejects(() => provider.generate({ messages: [] }), /returned no text/);
});
