import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryStore } from '../src/memory/memory-store.js';
import { createCandidateSelector } from '../src/memory/retrieval/candidate-selector.js';
import { createContextComposer } from '../src/memory/retrieval/context-composer.js';
import { createMemoryRetriever } from '../src/memory/retrieval/memory-retriever.js';
import { createRedundancyFilter } from '../src/memory/retrieval/redundancy-filter.js';
import { createRelevanceScorer } from '../src/memory/retrieval/relevance-scorer.js';
import { createTokenBudget } from '../src/memory/retrieval/token-budget.js';

function makeRetriever(store, options = {}) {
    return createMemoryRetriever({
        selector: createCandidateSelector({ store }),
        scorer: createRelevanceScorer({ now: () => Date.parse('2026-07-19T12:00:00Z') }),
        redundancy: createRedundancyFilter(),
        budget: createTokenBudget({ estimateTokens: text => String(text).split(/\s+/).length }),
        composer: createContextComposer(),
        ...options,
    });
}

test('retrieval prioritizes entity overlap and core memories', async () => {
    let id = 0;
    const store = createMemoryStore({ recordOptions: { idFactory: () => `m-${++id}`, now: () => '2026-07-19T10:00:00Z' } });
    store.save({ type: 'core', content: 'Marcus swore to protect Elena.', entityIds: ['Marcus', 'Elena'], importance: 1 });
    store.save({ type: 'atomic', content: 'Marcus dislikes crowded trains.', entityIds: ['Marcus'], importance: 0.5 });
    store.save({ type: 'episode', content: 'Unrelated festival scene.', entityIds: ['Nora'], importance: 0.8 });

    const result = await makeRetriever(store).retrieve({ text: 'What does Marcus remember about Elena?', entityIds: ['Marcus', 'Elena'] }, { maxTokens: 40 });

    assert.equal(result.selected[0].record.type, 'core');
    assert.match(result.text, /Core Memories/);
    assert.doesNotMatch(result.text, /festival/i);
});

test('retrieval removes redundant memories and reports omissions', async () => {
    let id = 0;
    const store = createMemoryStore({ recordOptions: { idFactory: () => `m-${++id}`, now: () => '2026-07-19T10:00:00Z' } });
    store.save({ type: 'atomic', content: 'Marcus promised to protect Elena.', data: { subject: 'Marcus', predicate: 'promised', object: 'protect Elena' }, entityIds: ['Marcus', 'Elena'] });
    store.save({ type: 'atomic', content: 'Marcus promised that he would protect Elena.', data: { subject: 'Marcus', predicate: 'promised', object: 'protect Elena' }, entityIds: ['Marcus', 'Elena'] });

    const result = await makeRetriever(store).retrieve({ text: 'Marcus and Elena', entityIds: ['Marcus', 'Elena'] });

    assert.equal(result.selected.length, 1);
    assert.equal(result.omitted.length, 1);
    assert.equal(result.omitted[0].omissionReason, 'redundant');
});

test('retrieval obeys token budget and returns audit metadata', async () => {
    let id = 0;
    const store = createMemoryStore({ recordOptions: { idFactory: () => `m-${++id}`, now: () => '2026-07-19T10:00:00Z' } });
    store.save({ type: 'relationship', title: 'Marcus and Elena', content: 'Their trust has improved after the station escape.', entityIds: ['Marcus', 'Elena'], importance: 0.9 });
    store.save({ type: 'episode', title: 'Station Escape', content: 'They escaped Blackwell Station together under fire.', entityIds: ['Marcus', 'Elena'], importance: 0.8 });

    const result = await makeRetriever(store).retrieve({ text: 'Marcus Elena station', entityIds: ['Marcus', 'Elena'] }, { maxTokens: 10, includeMetadata: true });

    assert.ok(result.usedTokens <= 10);
    assert.ok(result.omitted.some(item => item.omissionReason === 'token-budget'));
    assert.ok(Array.isArray(result.records));
});

test('retrieval limits the scored candidate pool before composing context', async () => {
    let id = 0;
    const store = createMemoryStore({ recordOptions: { idFactory: () => `m-${++id}`, now: () => '2026-07-19T10:00:00Z' } });
    for (let index = 0; index < 6; index += 1) {
        store.save({ type: 'episode', content: `Station memory number ${index}.`, importance: 0.9 - (index * 0.05) });
    }
    const result = await makeRetriever(store).retrieve({ text: 'station' }, { maxTokens: 100, candidateLimit: 2 });
    assert.equal(result.eligibleCount, 6);
    assert.equal(result.scoredCount, 2);
    assert.equal(result.candidateLimit, 2);
    assert.ok(result.selected.length <= 2);
});

test('retrieval blends semantic similarity into deterministic ranking', async () => {
    let id = 0;
    const store = createMemoryStore({ recordOptions: { idFactory: () => `m-${++id}`, now: () => '2026-07-19T10:00:00Z' } });
    store.save({ type: 'atomic', content: 'The harbor bell rang at midnight.', importance: 0.8 });
    const semanticMatch = store.save({ type: 'atomic', content: 'Mara concealed the moonstone.', importance: 0.5 });
    const semantic = { query: async () => new Map([[semanticMatch.id, 0.95]]) };

    const result = await makeRetriever(store, { semantic }).retrieve(
        { text: 'Where is the hidden jewel?' },
        { maxTokens: 50, semanticWeight: 2 },
    );

    assert.equal(result.selected[0].record.id, semanticMatch.id);
    assert.equal(result.semanticMatchCount, 1);
    assert.equal(result.selected[0].components.semantic, 1.9);
});
