import test from 'node:test';
import assert from 'node:assert/strict';
import { createHelperSchedulingPolicy } from '../src/agents/helper-scheduling-policy.js';
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
