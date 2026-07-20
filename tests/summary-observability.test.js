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
    assert.equal(snapshot.helpers.byStatus.running, 1);
    assert.equal(snapshot.recentEvents.length, 2);
    assert.match(service.renderText(), /120\/500 tokens/);
});
