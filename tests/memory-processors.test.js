import assert from 'node:assert/strict';
import test from 'node:test';

import { createMemoryPipeline } from '../src/memory/memory-pipeline.js';
import { createMemoryStore } from '../src/memory/memory-store.js';
import { createContradictionDetector } from '../src/memory/processors/contradiction-detector.js';
import { createDeduplicator } from '../src/memory/processors/deduplicator.js';
import { createImportanceScorer } from '../src/memory/processors/importance-scorer.js';
import { createSourceLedger } from '../src/memory/source-ledger.js';

function setup() {
    const sourceLedger = createSourceLedger();
    const store = createMemoryStore({
        sourceLedger,
        recordOptions: {
            idFactory: (() => {
                let index = 0;
                return () => `memory-${++index}`;
            })(),
            now: () => '2026-07-19T00:00:00.000Z',
        },
    });
    const pipeline = createMemoryPipeline({ store, sourceLedger });
    pipeline.registerProcessor(createDeduplicator());
    pipeline.registerProcessor(createContradictionDetector());
    pipeline.registerProcessor(createImportanceScorer());
    return { sourceLedger, store, pipeline };
}

function extractor(candidate) {
    return { name: 'fixture', extract: async () => [candidate] };
}

test('deduplicator merges repeated facts into the existing memory', async () => {
    const { pipeline, store } = setup();
    const candidate = {
        type: 'atomic',
        title: 'Marcus promise',
        content: 'Marcus promised to protect Elena.',
        entities: ['Marcus', 'Elena'],
        tags: ['promise'],
        data: { subject: 'Marcus', predicate: 'promised', object: 'to protect Elena' },
        importance: 0.6,
        confidence: 0.8,
    };

    await pipeline.ingest({ extractor: extractor(candidate), input: '', sources: [{ chatId: 'c', messageId: '1' }] });
    const second = await pipeline.ingest({ extractor: extractor(candidate), input: '', sources: [{ chatId: 'c', messageId: '2' }] });

    assert.equal(second.length, 0);
    assert.equal(store.size, 1);
    const stored = store.list()[0];
    assert.equal(stored.metadata.duplicateCount, 1);
    assert.equal(stored.sourceIds.length, 2);
    assert.deepEqual(stored.entityIds, ['Marcus', 'Elena']);
});

test('living state contradictions supersede the previous state', async () => {
    const { pipeline, store } = setup();

    await pipeline.ingest({
        extractor: extractor({
            type: 'relationship',
            title: 'Marcus: trust',
            content: "Marcus's trust changed to 40.",
            entities: ['Marcus'],
            data: { subject: 'Marcus', field: 'trust', newValue: 40 },
        }),
        input: '',
        sources: [{ chatId: 'c', messageId: '1' }],
    });

    const newer = await pipeline.ingest({
        extractor: extractor({
            type: 'relationship',
            title: 'Marcus: trust',
            content: "Marcus's trust changed to 70.",
            entities: ['Marcus'],
            data: { subject: 'Marcus', field: 'trust', newValue: 70 },
        }),
        input: '',
        sources: [{ chatId: 'c', messageId: '2' }],
    });

    assert.equal(newer.length, 1);
    const oldRecord = store.get('memory-1');
    const newRecord = store.get('memory-2');
    assert.equal(oldRecord.status, 'superseded');
    assert.equal(newRecord.supersedes, oldRecord.id);
    assert.equal(newRecord.metadata.contradictionPolicy, 'supersede-existing');
});

test('atomic contradictions preserve both versions and flag review', async () => {
    const { pipeline, store } = setup();

    const base = {
        type: 'atomic',
        title: 'Marcus allegiance',
        entities: ['Marcus'],
        data: { subject: 'Marcus', predicate: 'serves', object: 'House Vale' },
        content: 'Marcus serves House Vale.',
    };
    await pipeline.ingest({ extractor: extractor(base), input: '', sources: [{ chatId: 'c', messageId: '1' }] });
    await pipeline.ingest({
        extractor: extractor({
            ...base,
            data: { ...base.data, object: 'The Crown' },
            content: 'Marcus serves the Crown.',
        }),
        input: '',
        sources: [{ chatId: 'c', messageId: '2' }],
    });

    assert.equal(store.size, 2);
    const newest = store.get('memory-2');
    assert.equal(newest.metadata.requiresReview, true);
    assert.ok(newest.tags.includes('contradiction'));
});

test('importance scorer applies deterministic signals and records its reasoning', async () => {
    const { pipeline } = setup();
    const saved = await pipeline.ingest({
        extractor: extractor({
            type: 'episode',
            title: 'The betrayal',
            content: 'Marcus betrayed the party and escaped.',
            entities: ['Marcus'],
            tags: ['betrayal', 'unresolved'],
            data: { unresolvedThreads: ['Where did Marcus go?'] },
            importance: 0.4,
            confidence: 0.9,
        }),
        input: '',
        sources: [{ chatId: 'c', messageId: '1' }],
    });

    assert.equal(saved.length, 1);
    assert.ok(saved[0].importance > 0.6);
    assert.equal(saved[0].metadata.importanceScoring.version, 1);
});
