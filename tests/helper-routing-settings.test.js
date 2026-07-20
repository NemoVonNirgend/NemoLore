import test from 'node:test';
import assert from 'node:assert/strict';
import { createHelperSchedulingPolicy } from '../src/agents/helper-scheduling-policy.js';
import { createPostReplyDispatcher } from '../src/agents/post-reply-dispatcher.js';
import { createResilientGenerationRouter } from '../src/providers/resilient-generation-router.js';

function createRegistry(handlers) {
    return {
        activeProvider: 'primary',
        has: name => Boolean(handlers[name]),
        async generate(input, { provider }) { return handlers[provider](input); },
    };
}

test('routes workflows to overrides and falls back after provider failure', async () => {
    const calls = [];
    const registry = createRegistry({
        primary: async () => { calls.push('primary'); throw new Error('down'); },
        fallback: async () => { calls.push('fallback'); return { text: 'ok' }; },
    });
    const router = createResilientGenerationRouter({
        registry,
        settings: {
            helperAgentProvider: 'primary',
            helperSummaryProvider: 'primary',
            helperFallbackProvider: 'fallback',
            helperRetryCount: 0,
            helperRequestTimeoutMs: 1000,
        },
    });

    const result = await router.generate({ metadata: { task: 'summary' } }, { workflow: 'summary' });
    assert.equal(result.text, 'ok');
    assert.deepEqual(calls, ['primary', 'fallback']);
    assert.equal(router.routeFor('summary'), 'primary');
});

test('stale persisted provider names fall back to the active built-in provider', async () => {
    const calls = [];
    const registry = createRegistry({
        primary: async () => { calls.push('primary'); return { text: 'ok' }; },
    });
    const router = createResilientGenerationRouter({
        registry,
        settings: {
            helperAgentProvider: 'async',
            helperSummaryProvider: 'removed-provider',
            helperRetryCount: 0,
        },
    });

    assert.equal(router.routeFor('summary'), 'primary');
    assert.equal((await router.generate({}, { workflow: 'summary' })).text, 'ok');
    assert.deepEqual(calls, ['primary']);
});

test('opens a circuit after repeated failures', async () => {
    let attempts = 0;
    const router = createResilientGenerationRouter({
        registry: createRegistry({ primary: async () => { attempts += 1; throw new Error('down'); } }),
        settings: {
            helperAgentProvider: 'primary',
            helperRetryCount: 0,
            helperCircuitBreakerFailures: 1,
            helperCircuitBreakerCooldownMs: 60000,
        },
    });

    await assert.rejects(router.generate({}, { workflow: 'memory' }));
    await assert.rejects(router.generate({}, { workflow: 'memory' }), /circuit is open/);
    assert.equal(attempts, 1);
});

test('scheduling policy enforces limits, minimums, and lore signals', () => {
    let now = 1000;
    const settings = {
        helperMemoryAfterReply: true,
        helperSummaryAfterReply: true,
        helperLoreAfterReply: true,
        helperMaxCallsPerReply: 2,
        helperMemoryMinMessages: 0,
        helperSummaryMinMessages: 4,
        helperLoreMinMessages: 2,
        helperLoreRequireSignal: true,
        helperMemoryCooldownMs: 1000,
    };
    const policy = createHelperSchedulingPolicy({ settings, clock: { now: () => now } });

    const first = policy.select({ chatId: 'chat', messageCount: 5, input: 'Marcus discovered the hidden gate.' });
    assert.deepEqual(first.selected.map(item => item.workflow), ['memory', 'summary']);

    const second = policy.select({ chatId: 'chat', messageCount: 5, input: 'quiet reply' });
    assert.equal(second.decisions.find(item => item.workflow === 'memory').reason, 'cooldown');
    assert.equal(second.decisions.find(item => item.workflow === 'lore').reason, 'no-lore-signal');

    now += 1001;
    assert.equal(policy.evaluate('memory', { chatId: 'chat', messageCount: 5 }).allowed, true);
});

<<<<<<< HEAD
test('engine-disabled workflows do not consume scheduling capacity or cooldowns', () => {
    let now = 100_000;
    const settings = {
        enableHelperAgents: true,
        summaryEngineMode: 'legacy',
        loreEngineMode: 'modular',
=======
test('profile cadence controls summary and lore frequency per chat', () => {
    const settings = {
>>>>>>> dev/preset-architecture
        helperMemoryAfterReply: false,
        helperSummaryAfterReply: true,
        helperLoreAfterReply: true,
        helperSummaryMinMessages: 0,
        helperLoreMinMessages: 0,
<<<<<<< HEAD
        helperSummaryCooldownMs: 60_000,
        helperLoreCooldownMs: 60_000,
        helperLoreRequireSignal: false,
        helperMaxCallsPerReply: 1,
    };
    const policy = createHelperSchedulingPolicy({ settings, clock: { now: () => now } });
    let requests = [];
    const dispatcher = createPostReplyDispatcher({
        runtime: { enqueueMany(value) { requests = value; return value; } },
        settings,
        policy,
    });

    dispatcher.dispatch({ chatId: 'chat', messageId: '1', messageCount: 1, input: 'quiet reply' });

    assert.deepEqual(requests.map(request => request.agent), ['lore']);
    assert.equal(policy.evaluate('summary', { chatId: 'chat', messageCount: 1 }).allowed, true);
    assert.equal(policy.evaluate('lore', { chatId: 'chat', messageCount: 1 }).reason, 'cooldown');

    now += 60_001;
    assert.equal(policy.evaluate('lore', { chatId: 'chat', messageCount: 1 }).allowed, true);
=======
        helperLoreRequireSignal: false,
        helperMaxCallsPerReply: 3,
        summaryChunkSize: 8,
        loreUpdateStrategy: 'balanced',
    };
    const policy = createHelperSchedulingPolicy({ settings });
    assert.deepEqual(policy.select({ chatId: 'chat', messageCount: 10 }).selected.map(item => item.workflow), ['summary', 'lore']);
    const tooSoon = policy.select({ chatId: 'chat', messageCount: 12 });
    assert.equal(tooSoon.decisions.find(item => item.workflow === 'summary').reason, 'message-cadence');
    assert.equal(tooSoon.decisions.find(item => item.workflow === 'lore').reason, 'message-cadence');
    assert.deepEqual(policy.select({ chatId: 'chat', messageCount: 18 }).selected.map(item => item.workflow), ['summary', 'lore']);

    settings.summaryChunkSize = 4;
    settings.loreUpdateStrategy = 'aggressive';
    policy.reset();
    policy.select({ chatId: 'chat', messageCount: 20 });
    const aggressive = policy.select({ chatId: 'chat', messageCount: 21 });
    assert.equal(aggressive.decisions.find(item => item.workflow === 'summary').reason, 'message-cadence');
    assert.equal(aggressive.decisions.find(item => item.workflow === 'lore').allowed, true);
>>>>>>> dev/preset-architecture
});
