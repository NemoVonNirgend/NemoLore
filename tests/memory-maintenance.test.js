import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryAgingService } from '../src/memory/maintenance/memory-aging-service.js';
import { createMemoryConsolidationService } from '../src/memory/maintenance/memory-consolidation-service.js';
import { createMemoryStore } from '../src/memory/memory-store.js';
import { createSourceLedger } from '../src/memory/source-ledger.js';
import { MEMORY_STATUS, MEMORY_TYPES } from '../src/memory/memory-types.js';
import { createRelevanceScorer } from '../src/memory/retrieval/relevance-scorer.js';

function fixture(settings = {}) {
    const sourceLedger = createSourceLedger();
    const store = createMemoryStore({ sourceLedger });
    return { sourceLedger, store, settings };
}

function saveAt({ store, sourceLedger }, index, input = {}) {
    const source = sourceLedger.register({ chatId: 'chat', messageId: String(index), messageIndex: index });
    return store.save({ type: MEMORY_TYPES.ATOMIC, content: `Memory ${index}`, sourceIds: [source.id], ...input });
}

test('aging lowers retrieval pressure without changing semantic importance', () => {
    const context = fixture({ memoryAgingEnabled: true, memoryAgingGraceMessages: 10, memoryAgingRate: 0.2, memoryAgingFloor: 0.3 });
    const old = saveAt(context, 1, { importance: 0.8 });
    const core = saveAt(context, 1, { type: MEMORY_TYPES.CORE, content: 'Never ages', importance: 1 });
    const aging = createMemoryAgingService(context);

    assert.deepEqual(aging.run({ messageCount: 32 }).aged, [old.id]);
    assert.equal(context.store.get(old.id).importance, 0.8);
    assert.ok(Math.abs(context.store.get(old.id).metadata.aging.retrievalMultiplier - 0.4) < 0.0001);
    assert.equal(context.store.get(core.id).metadata.aging, undefined);

    const scorer = createRelevanceScorer({ now: () => Date.now() });
    assert.ok(scorer.score(context.store.get(old.id), { text: 'Memory' }).score < scorer.score(core, { text: 'Never' }).score);
});

test('consolidation archives sources with provenance and can restore them', () => {
    const context = fixture({
        memoryConsolidationEnabled: true,
        memoryConsolidationMinRecords: 3,
        memoryConsolidationBatchSize: 3,
        memoryConsolidationSourceMode: 'archive',
    });
    const members = [1, 2, 3].map(index => saveAt(context, index, { entityIds: ['Mara'], title: `Event ${index}` }));
    const service = createMemoryConsolidationService(context);
    const result = service.run();

    assert.equal(result.consolidated.length, 1);
    const consolidated = context.store.get(result.consolidated[0]);
    assert.deepEqual([...consolidated.metadata.consolidation.memberIds].sort(), members.map(record => record.id).sort());
    assert.equal(consolidated.sourceIds.length, 3);
    assert.ok(members.every(record => context.store.get(record.id).status === MEMORY_STATUS.ARCHIVED));

    assert.equal(service.restore(consolidated.id), true);
    assert.ok(members.every(record => context.store.get(record.id).status === MEMORY_STATUS.ACTIVE));
    assert.equal(context.store.get(consolidated.id).status, MEMORY_STATUS.ARCHIVED);
});

test('Epic-style consolidation retains precise source memories', () => {
    const context = fixture({
        memoryConsolidationEnabled: true,
        memoryConsolidationMinRecords: 2,
        memoryConsolidationBatchSize: 2,
        memoryConsolidationSourceMode: 'retain',
    });
    const members = [1, 2].map(index => saveAt(context, index, { tags: ['quest'] }));
    createMemoryConsolidationService(context).run();
    assert.ok(members.every(record => context.store.get(record.id).status === MEMORY_STATUS.ACTIVE));
    assert.ok(members.every(record => context.store.get(record.id).metadata.consolidatedInto));
});
