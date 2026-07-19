import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtomicFactExtractor } from '../src/memory/extractors/atomic-fact-extractor.js';
import { createEpisodeExtractor } from '../src/memory/extractors/episode-extractor.js';
import { parseJsonResponse } from '../src/memory/extractors/json-response.js';
import { createStateChangeExtractor } from '../src/memory/extractors/state-change-extractor.js';
import { MEMORY_TYPES } from '../src/memory/memory-types.js';

function generationReturning(text) {
    return {
        async generate(request) {
            assert.ok(request.systemPrompt);
            assert.ok(request.prompt);
            return { text };
        },
    };
}

test('JSON parser recovers fenced model output', () => {
    const parsed = parseJsonResponse('```json\n{"memories":[]}\n```');
    assert.deepEqual(parsed, { memories: [] });
});

test('episode extractor maps structured scene memories', async () => {
    const extractor = createEpisodeExtractor({
        generation: generationReturning(JSON.stringify({ memories: [{
            title: 'Station confrontation',
            summary: 'Marcus confronted Elena at Blackwell Station.',
            participants: ['Marcus', 'Elena'],
            location: 'Blackwell Station',
            outcome: 'Elena left with the key.',
            unresolvedThreads: ['Marcus still distrusts Elena'],
            importance: 0.9,
            confidence: 0.95,
        }] })),
    });

    const [memory] = await extractor.extract({ input: 'source scene' });
    assert.equal(memory.type, MEMORY_TYPES.EPISODE);
    assert.deepEqual(memory.entities, ['Marcus', 'Elena']);
    assert.equal(memory.data.location, 'Blackwell Station');
});

test('atomic extractor emits one durable fact', async () => {
    const extractor = createAtomicFactExtractor({
        generation: generationReturning(JSON.stringify({
            subject: 'Marcus',
            predicate: 'promised',
            object: 'to protect Elena',
            tags: ['promise'],
        })),
    });

    const [memory] = await extractor.extract({ input: 'source scene' });
    assert.equal(memory.type, MEMORY_TYPES.ATOMIC);
    assert.equal(memory.data.object, 'to protect Elena');
    assert.ok(memory.tags.includes('promise'));
});

test('state extractor preserves dynamic living-memory type', async () => {
    const extractor = createStateChangeExtractor({
        generation: generationReturning(JSON.stringify({ memories: [{
            stateType: 'relationship',
            subject: 'Marcus and Elena',
            field: 'trust',
            previousValue: 30,
            newValue: 55,
            reason: 'Marcus revealed the truth.',
            entities: ['Marcus', 'Elena'],
        }] })),
    });

    const [memory] = await extractor.extract({ input: 'source scene' });
    assert.equal(memory.type, MEMORY_TYPES.RELATIONSHIP);
    assert.equal(memory.data.newValue, 55);
});

test('extractors reject malformed or incomplete candidates', async () => {
    const malformed = createEpisodeExtractor({ generation: generationReturning('not json') });
    await assert.rejects(() => malformed.extract({ input: 'source scene' }), /parse extractor JSON/i);

    const incomplete = createAtomicFactExtractor({
        generation: generationReturning('{"subject":"Marcus"}'),
    });
    await assert.rejects(() => incomplete.extract({ input: 'source scene' }), /predicate is required/i);
});
