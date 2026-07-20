import test from 'node:test';
import assert from 'node:assert/strict';

import { createCorePromotionService } from '../src/memory/maintenance/core-promotion-service.js';
import { createEpisodePromotionService } from '../src/memory/maintenance/episode-promotion-service.js';
import { createMemoryStore } from '../src/memory/memory-store.js';
import { createSourceLedger } from '../src/memory/source-ledger.js';
import { MEMORY_STATUS, MEMORY_TYPES } from '../src/memory/memory-types.js';

function fixture(settings) {
    const sourceLedger = createSourceLedger();
    const store = createMemoryStore({ sourceLedger });
    return { sourceLedger, store, settings };
}

function atomic(context, index, input = {}) {
    const source = context.sourceLedger.register({ chatId: 'chat', messageId: String(index), messageIndex: index });
    return context.store.save({
        type: MEMORY_TYPES.ATOMIC,
        content: `Fact ${index}`,
        entityIds: ['Mara'],
        sourceIds: [source.id],
        importance: 0.7,
        ...input,
    });
}

test('episode promotion archives related atomic details and restores them reversibly', () => {
    const context = fixture({ episodePromotionThreshold: 3, episodePromotionSourceMode: 'archive' });
    const members = [1, 2, 3].map(index => atomic(context, index));
    const service = createEpisodePromotionService(context);
    const result = service.run();
    assert.equal(result.episodes.length, 1);
    const episode = context.store.get(result.episodes[0]);
    assert.equal(episode.type, MEMORY_TYPES.EPISODE);
    assert.deepEqual([...episode.metadata.episodePromotion.memberIds].sort(), members.map(record => record.id).sort());
    assert.ok(members.every(record => context.store.get(record.id).status === MEMORY_STATUS.ARCHIVED));
    assert.equal(service.run().episodes.length, 0);

    assert.equal(service.restore(episode.id), true);
    assert.ok(members.every(record => context.store.get(record.id).status === MEMORY_STATUS.ACTIVE));
    assert.equal(context.store.get(episode.id).status, MEMORY_STATUS.ARCHIVED);
});

test('Epic-style episode promotion retains precise atomic details', () => {
    const context = fixture({ episodePromotionThreshold: 2, episodePromotionSourceMode: 'retain' });
    const members = [1, 2].map(index => atomic(context, index));
    const result = createEpisodePromotionService(context).run();
    assert.equal(result.episodes.length, 1);
    assert.ok(members.every(record => context.store.get(record.id).status === MEMORY_STATUS.ACTIVE));
});

test('core promotion respects chat depth, importance, limits, and reversible type metadata', () => {
    const context = fixture({
        enableCoreMemories: true,
        coreMemoryStartCount: 10,
        coreMemoryImportanceThreshold: 0.85,
        coreMemoryMaxPromotionsPerRun: 1,
    });
    const strongest = atomic(context, 1, { importance: 0.96, tags: ['promise'] });
    const second = atomic(context, 2, { importance: 0.9 });
    atomic(context, 3, { importance: 0.5 });
    const service = createCorePromotionService(context);

    assert.equal(service.run({ messageCount: 9 }).promoted.length, 0);
    assert.deepEqual(service.run({ messageCount: 10 }).promoted, [strongest.id]);
    assert.equal(context.store.get(strongest.id).type, MEMORY_TYPES.CORE);
    assert.equal(context.store.get(second.id).type, MEMORY_TYPES.ATOMIC);
    assert.equal(context.store.get(strongest.id).metadata.corePromotion.originalType, MEMORY_TYPES.ATOMIC);

    assert.equal(service.restore(strongest.id), true);
    assert.equal(context.store.get(strongest.id).type, MEMORY_TYPES.ATOMIC);
    assert.deepEqual(context.store.get(strongest.id).tags, ['promise']);
});
