import test from 'node:test';
import assert from 'node:assert/strict';

import { createProviderRegistry } from '../src/providers/provider-registry.js';
import { createOpenAICompatibleProvider } from '../src/providers/openai-compatible-provider.js';

const logger = { debug() {}, error() {} };

test('provider registry selects and normalizes providers', async () => {
    const registry = createProviderRegistry({ logger });
    registry.register('first', {
        async generate(request) {
            return { text: request.messages[0].content.toUpperCase(), model: 'fake' };
        },
    });

    const result = await registry.generate({ prompt: 'hello' });
    assert.equal(result.text, 'HELLO');
    assert.equal(result.provider, 'first');
    assert.equal(result.model, 'fake');
});

test('provider registry supports explicit provider selection', async () => {
    const registry = createProviderRegistry({ logger });
    registry.register('one', { async generate() { return 'one'; } });
    registry.register('two', { async generate() { return 'two'; } });

    const result = await registry.generate({ prompt: 'x' }, { provider: 'two' });
    assert.equal(result.text, 'two');
});

test('generation rejects empty requests', async () => {
    const registry = createProviderRegistry({ logger });
    registry.register('fake', { async generate() { return 'unused'; } });
    await assert.rejects(() => registry.generate({}), /prompt or messages/);
});

test('OpenAI-compatible provider sends normalized chat payload', async () => {
    let captured;
    const provider = createOpenAICompatibleProvider({
        endpoint: 'https://example.invalid/v1/chat/completions',
        apiKey: 'secret',
        model: 'demo-model',
        fetchImpl: async (url, options) => {
            captured = { url, options };
            return {
                ok: true,
                async json() {
                    return {
                        model: 'demo-model',
                        choices: [{ message: { content: 'generated text' } }],
                        usage: { total_tokens: 12 },
                    };
                },
            };
        },
    });

    const registry = createProviderRegistry({ logger });
    registry.register('http', provider);
    const result = await registry.generate({ prompt: 'Write lore.', maxTokens: 200 });

    const payload = JSON.parse(captured.options.body);
    assert.equal(captured.url, 'https://example.invalid/v1/chat/completions');
    assert.equal(captured.options.headers.Authorization, 'Bearer secret');
    assert.equal(payload.model, 'demo-model');
    assert.equal(payload.messages[0].content, 'Write lore.');
    assert.equal(payload.max_tokens, 200);
    assert.equal(result.text, 'generated text');
    assert.equal(result.usage.total_tokens, 12);
});

test('OpenAI-compatible provider surfaces HTTP errors', async () => {
    const provider = createOpenAICompatibleProvider({
        endpoint: 'https://example.invalid',
        fetchImpl: async () => ({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            async text() { return 'rate limited'; },
        }),
    });

    await assert.rejects(
        () => provider.generate({ messages: [{ role: 'user', content: 'x' }] }),
        /429.*rate limited/,
    );
});
