import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/memory/memory-store.js';
import { createMemoryManagementService } from '../src/memory/memory-management-service.js';

function createHarness() {
    const store = createMemoryStore();
    store.save({
        id: 'fact-1',
        type: 'atomic',
        title: 'Marcus allegiance',
        content: 'Marcus serves the Crown.',
        tags: ['character', 'contradiction', 'review-required'],
        entityIds: ['Marcus'],
        sourceIds: ['chat:1'],
        importance: 0.6,
        confidence: 0.8,
        metadata: { requiresReview: true },
    });
    store.save({
        id: 'episode-1',
        type: 'episode',
        title: 'Station escape',
        content: 'Elena escaped the station.',
        tags: ['escape'],
        entityIds: ['Elena'],
        sourceIds: ['chat:2'],
        importance: 0.9,
        confidence: 1,
    });
    return { store, management: createMemoryManagementService({ store }) };
}

test('filters memories by search, type, status, entity and review state', () => {
    const { management } = createHarness();
    assert.deepEqual(management.list({ search: 'Crown' }).map(record => record.id), ['fact-1']);
    assert.deepEqual(management.list({ type: 'episode' }).map(record => record.id), ['episode-1']);
    assert.deepEqual(management.list({ entityId: 'Marcus' }).map(record => record.id), ['fact-1']);
    assert.deepEqual(management.list({ reviewOnly: true }).map(record => record.id), ['fact-1']);
});

test('edits fields and emits a normal persistent store update', () => {
    const { store, management } = createHarness();
    const events = [];
    store.subscribe((event, record) => events.push([event, record?.id]));
    const result = management.edit('fact-1', {
        title: 'Marcus loyalty',
        content: 'Marcus secretly opposes the Crown.',
        tags: 'character, secret',
        entityIds: 'Marcus, Crown',
        importance: 0.95,
        confidence: 0.7,
    });
    assert.equal(result.title, 'Marcus loyalty');
    assert.deepEqual(result.tags, ['character', 'secret']);
    assert.deepEqual(result.entityIds, ['Marcus', 'Crown']);
    assert.equal(result.importance, 0.95);
    assert.equal(result.revision, 2);
    assert.deepEqual(events.at(-1), ['updated', 'fact-1']);
});

test('invalidates, restores and archives memories', () => {
    const { management } = createHarness();
    assert.equal(management.invalidate('fact-1').status, 'invalidated');
    assert.equal(management.restore('fact-1').status, 'active');
    assert.equal(management.archive('fact-1').status, 'archived');
});

test('promotes a memory to core and raises importance', () => {
    const { management } = createHarness();
    const result = management.promoteToCore('fact-1');
    assert.equal(result.type, 'core');
    assert.equal(result.status, 'active');
    assert.equal(result.importance, 0.9);
    assert.ok(result.tags.includes('core'));
    assert.ok(result.tags.includes('promoted'));
    assert.equal(result.metadata.promotedFromType, 'atomic');
});

test('review resolution clears contradiction markers without losing other tags', () => {
    const { management } = createHarness();
    const result = management.markReviewed('fact-1', 'accepted-current');
    assert.deepEqual(result.tags, ['character']);
    assert.equal(result.metadata.requiresReview, false);
    assert.equal(result.metadata.reviewResolution, 'accepted-current');
});

test('facets expose available types, statuses, tags and entities', () => {
    const { management } = createHarness();
    const facets = management.facets();
    assert.deepEqual(facets.types, ['atomic', 'episode']);
    assert.deepEqual(facets.statuses, ['active']);
    assert.ok(facets.tags.includes('contradiction'));
    assert.deepEqual(facets.entities, ['Elena', 'Marcus']);
});
