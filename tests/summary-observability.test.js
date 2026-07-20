import test from 'node:test';
import assert from 'node:assert/strict';
import { createSummaryContextContributor } from '../src/summary/summary-context-contributor.js';
import { createObservabilityService } from '../src/observability/observability-service.js';

test('summary contributor injects modular summary and records source metadata', async () => {
    const contributor = createSummaryContextContributor({
        summaryStore: {
            get: () => ({ text: 'New continuity summary.', updatedAt: 20, sourceMessageIds: ['2'] }),
        },
        legacySummaries: { chat: 'Legacy summary.' },
        settings: { summaryContextPrecedence: 'new-first' },
    });

    const contribution = await contributor.contribute({ chatId: 'chat' });
    assert.match(contribution.content, /New continuity summary/);
    assert.equal(contribution.metadata.summarySource, 'modular');
    assert.equal(contribution.metadata.precedence, 'modular-only');
});

test('summary contributor ignores retired legacy summary storage', async () => {
    const contributor = createSummaryContextContributor({
        summaryStore: { get: () => ({ text: 'New summary.' }) },
        legacySummaries: { chat: { summary: 'Legacy summary.' } },
        settings: { summaryContextPrecedence: 'legacy-only' },
    });

    const contribution = await contributor.contribute({ chatId: 'chat' });
    assert.match(contribution.content, /New summary/);
    assert.doesNotMatch(contribution.content, /Legacy summary/);
    assert.equal(contribution.metadata.summarySource, 'modular');
});

test('native NemoTavern running summary participates in legacy precedence ahead of settings chatSummaries', async () => {
    const contributor = createSummaryContextContributor({
        summaryStore: { get: () => ({ text: 'Modular summary.' }) },
        legacySummaries: { chat: 'Settings summary.' },
        getMetadata: () => ({ nemolore: { summary: 'Native running summary.' } }),
        settings: { summaryContextPrecedence: 'legacy-first' },
        ownership: { ownerFor: () => 'nemolore-modular' },
    });

    const contribution = await contributor.contribute({ chatId: 'chat' });
    assert.match(contribution.content, /Native running summary/);
    assert.equal(contribution.metadata.summarySource, 'legacy');
    assert.equal(contribution.metadata.legacySummarySource, 'nemotavern');
});

test('summary contributor leaves context placement to the legacy or native owner', async () => {
    const contributor = createSummaryContextContributor({
        summaryStore: { get: () => ({ text: 'Would duplicate.' }) },
        settings: { summaryContextPrecedence: 'new-first' },
        ownership: { ownerFor: () => 'nemotavern' },
    });
    assert.deepEqual(await contributor.contribute({ chatId: 'chat' }), []);
});

test('stock SillyTavern observability omits the optional host section', () => {
    const service = createObservabilityService({
        hostInterop: { snapshot: () => ({ available: false }), observabilitySnapshot: () => ({}) },
    });
    assert.equal(service.snapshot().host, null);
});

test('observability snapshot exposes native host ledger, provenance, and engine owners', () => {
    const memory = { summaries: [{ summary: 'Native summary.' }], chunks: [{ text: 'Native chunk.' }] };
    const ownership = { summaryOwner: 'nemolore-modular', loreOwner: 'nemotavern', memoryOwner: 'nemotavern' };
    const service = createObservabilityService({
        hostInterop: {
            snapshot: () => ({ available: true, capabilities: { memory: true, provenance: true } }),
            observabilitySnapshot: () => ({ memory, contextLedger: memory, provenance: { promptHash: 'hash-1' } }),
        },
        ownership: { snapshot: () => ownership },
    });
    const snapshot = service.snapshot();
    assert.deepEqual(snapshot.host.memory, memory);
    assert.equal(snapshot.host.contextLedger.chunks.length, 1);
    assert.equal(snapshot.host.provenance.promptHash, 'hash-1');
    assert.deepEqual(snapshot.ownership, ownership);
});

test('observability snapshot exposes context, memory, summary, lore, and helper state', () => {
    const helperListeners = [];
    const memoryListeners = [];
    const service = createObservabilityService({
        contextBridge: {
            inspect: () => ({
                usedTokens: 120,
                maxTokens: 500,
                selected: [
                    { id: 'summary:chat', source: 'summary', content: 'Summary' },
                    { id: 'memory:1', source: 'memory', content: 'Memory' },
                ],
                omitted: [{ id: 'lore:large', source: 'lore', omissionReason: 'token-budget' }],
                errors: [],
                byPosition: { 'after-system': 'Summary\n\nMemory' },
            }),
        },
        contextRegistry: { list: () => ['summary', 'memory'] },
        helperRuntime: {
            subscribe: listener => { helperListeners.push(listener); return () => {}; },
            list: () => [
                { id: 'job-1', status: 'running' },
                { id: 'job-2', status: 'succeeded' },
            ],
            inspect: () => ({ running: 1, queued: 0, concurrency: 3 }),
        },
        memoryStore: {
            subscribe: listener => { memoryListeners.push(listener); return () => {}; },
            list: () => [
                { id: 'm1', type: 'atomic', status: 'active' },
                { id: 'm2', type: 'episode', status: 'invalidated' },
            ],
        },
        summaryStore: { get: () => ({ text: 'Summary text' }) },
        lorebooks: { getAssociatedName: () => 'NemoLore_chat' },
        semanticMemory: { inspect: () => ({ available: true, indexedCount: 2, activeMemoryCount: 2 }) },
        hostInterop: {
            snapshot: () => ({ available: true, version: 'test-host' }),
            observabilitySnapshot: () => ({ contextLedger: { entries: 1 }, provenance: { model: 'host-model' } }),
        },
        ownership: { snapshot: () => ({ summaryOwner: 'nemolore-modular' }) },
        getChatId: () => 'chat',
    });

    helperListeners[0]('started', { id: 'job-3', status: 'running' });
    memoryListeners[0]('saved', { id: 'm3', type: 'entity' });

    const snapshot = service.snapshot();
    assert.equal(snapshot.context.usedTokens, 120);
    assert.equal(snapshot.context.sources.summary, 1);
    assert.equal(snapshot.context.omittedCount, 1);
    assert.equal(snapshot.memory.total, 2);
    assert.equal(snapshot.memory.byStatus.active, 1);
    assert.equal(snapshot.summary.text, 'Summary text');
    assert.equal(snapshot.lorebook, 'NemoLore_chat');
    assert.equal(snapshot.semanticMemory.indexedCount, 2);
    assert.equal(snapshot.host.version, 'test-host');
    assert.equal(snapshot.ownership.summaryOwner, 'nemolore-modular');
    assert.equal(snapshot.helpers.byStatus.running, 1);
    assert.equal(snapshot.recentEvents.length, 2);
    assert.match(service.renderText(), /120\/500 tokens/);
    assert.match(service.renderText(), /2 indexed/);
    assert.match(service.renderText(), /NemoTavern host: available/);
});

test('observability rebuilds semantic memory and records the recovery event', async () => {
    let rebuilds = 0;
    const service = createObservabilityService({
        semanticMemory: {
            inspect: () => ({ available: true, indexedCount: 1 }),
            rebuild: async () => { rebuilds += 1; return { enabled: true, rebuild: true, indexed: 3 }; },
        },
    });

    const result = await service.rebuildSemanticIndex();
    assert.equal(rebuilds, 1);
    assert.equal(result.indexed, 3);
    assert.equal(service.history().at(-1).type, 'semantic-memory');
    assert.equal(service.history().at(-1).event, 'rebuild');
});
