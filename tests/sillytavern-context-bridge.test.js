import test from 'node:test';
import assert from 'node:assert/strict';

import { createSillyTavernExtensionPromptAdapter } from '../src/integrations/sillytavern-extension-prompt-adapter.js';
import { createSillyTavernContextBridge } from '../src/integrations/sillytavern-context-bridge.js';
import { createSillyTavernContextInterceptor } from '../src/integrations/sillytavern-context-interceptor.js';

const packageFixture = Object.freeze({
    byPosition: {
        'after-system': 'Remember the station promise.',
        'after-chat': 'Current location: Blackwell Station.',
    },
    selected: [{ id: 'memory:1' }],
    usedTokens: 12,
});

test('extension prompt adapter delegates to the runtime context API', () => {
    const calls = [];
    const adapter = createSillyTavernExtensionPromptAdapter({
        resolveContext: () => ({
            setExtensionPrompt: (...args) => calls.push(args),
        }),
    });

    adapter.write('slot', 'content', {
        position: 1,
        depth: 4,
        scan: true,
        role: 2,
    });

    assert.deepEqual(calls, [['slot', 'content', 1, 4, true, 2]]);
});

test('context bridge synchronizes every slot and clears stale positions', async () => {
    const writes = [];
    const injector = { inject: async () => packageFixture };
    const promptAdapter = {
        write: (id, content, config) => writes.push({ id, content, config }),
        clear: (id, config) => writes.push({ id, content: '', config }),
    };
    const bridge = createSillyTavernContextBridge({ injector, promptAdapter });

    const result = await bridge.refresh({ text: 'hello' });

    assert.equal(result, packageFixture);
    assert.equal(writes.length, 4);
    assert.equal(writes.find(item => item.id === 'nemolore:after-system').content, 'Remember the station promise.');
    assert.equal(writes.find(item => item.id === 'nemolore:before-system').content, '');
    assert.equal(bridge.inspect(), packageFixture);

    bridge.clear();
    assert.equal(bridge.inspect(), null);
});

test('context interceptor refreshes before delegating to the legacy handler', async () => {
    const order = [];
    const interceptor = createSillyTavernContextInterceptor({
        bridge: {
            refresh: async request => order.push(['refresh', request.text]),
        },
        requestFactory: message => ({ text: message }),
        next: async message => {
            order.push(['next', message]);
            return 'legacy-result';
        },
    });

    const result = await interceptor('latest message');
    assert.equal(result, 'legacy-result');
    assert.deepEqual(order, [
        ['refresh', 'latest message'],
        ['next', 'latest message'],
    ]);
});

test('context interceptor isolates bridge failures by default', async () => {
    let nextCalled = false;
    const interceptor = createSillyTavernContextInterceptor({
        bridge: { refresh: async () => { throw new Error('bridge failed'); } },
        next: async () => { nextCalled = true; },
    });

    await interceptor('message');
    assert.equal(nextCalled, true);
});
