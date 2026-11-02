import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import test from 'node:test';
import { createEpisodeExtractor } from '../src/memory/extractors/episode-extractor.js';
import { createLoreGenerationService } from '../src/lore/lore-generation-service.js';
import { createSummaryService } from '../src/summary/summary-service.js';
import { createSummaryStore } from '../src/summary/summary-store.js';
import { createProviderRegistry } from '../src/providers/provider-registry.js';
import { createSillyTavernProvider } from '../src/providers/sillytavern-provider.js';
import { createOpenAICompatibleProvider } from '../src/providers/openai-compatible-provider.js';

const bootstrap = readFileSync(new URL('../bootstrap.js', import.meta.url), 'utf8');
const registration = bootstrap.slice(
    bootstrap.indexOf("providers.register('sillytavern'"),
    bootstrap.indexOf('function synchronizeAsyncProvider'),
);

const responses = {
    memory: '{"memories":[]}',
    summary: 'The travellers reached the station.',
    lore: '{"entries":[]}',
};

async function invoke(workflow, generation, maxTokens, temperature) {
    if (workflow === 'memory') {
        return createEpisodeExtractor({ generation }).extract({
            input: 'The travellers reached the station.', context: { maxTokens, temperature },
        });
    }
    if (workflow === 'summary') {
        return createSummaryService({
            generation,
            store: createSummaryStore({ metadata: {}, saveMetadata: async () => {} }),
            settings: {},
        }).summarize({
            chatId: 'chat', messages: [{ id: '1', mes: 'The travellers reached the station.' }], maxTokens, temperature,
        });
    }
    return createLoreGenerationService({
        generation,
        lorebooks: {
            async ensureForChat() { return 'book'; },
            async load() { return { entries: {} }; },
        },
    }).preview({ chatId: 'chat', input: 'The travellers reached the station.', maxTokens, temperature });
}

for (const workflow of Object.keys(responses)) {
    test(`${workflow}: current chat-completion helpers use isolated native requests, inheriting temperature unless explicit`, async () => {
        const calls = [];
        const providers = createProviderRegistry();
        new Script(registration).runInNewContext({
            providers, createSillyTavernProvider, logger: undefined,
            getContext: () => ({ mainApi: 'openai', ChatCompletionService: { sendRequest() {} } }),
            nativeOpenai: { createGenerationParameters() {} },
            helperConnections: { generateCurrent: async request => { calls.push(request); return { text: responses[workflow], model: 'current-model' }; } },
            generateRaw() { assert.fail('Chat-completion helpers must not enter foreground prompt hooks or temporary settings.'); },
        });
        for (const temperature of [undefined, null, 0, 0.75]) {
            await invoke(workflow, providers, null, temperature);
            assert.equal(calls.at(-1).temperature, temperature ?? null);
            assert.ok(calls.at(-1).messages.some(message => message.role === 'system'));
        }
    });

    test(`${workflow}: production SillyTavern route inherits the active limit unless explicitly overridden`, async () => {
        const calls = [];
        const providers = createProviderRegistry();
        // Exercise the actual bootstrap callback that maps maxTokens to responseLength.
        new Script(registration).runInNewContext({
            providers, createSillyTavernProvider, logger: undefined,
            getContext: () => ({ mainApi: 'kobold' }),
            async generateRaw(options) {
                calls.push(options);
                return responses[workflow];
            },
        });

        for (const maxTokens of [undefined, null, 64000]) {
            await invoke(workflow, providers, maxTokens);
            assert.equal(calls.at(-1).responseLength, maxTokens ?? null);
            assert.ok(calls.at(-1).prompt);
        }
        assert.equal(calls.length, 3);
    });

    test(`${workflow}: direct API omits the default output cap and preserves explicit limits`, async () => {
        const calls = [];
        const providers = createProviderRegistry();
        providers.register('async', createOpenAICompatibleProvider({
            endpoint: 'https://example.invalid/v1/chat/completions', model: 'helper',
            async fetchImpl(_url, options) {
                calls.push(JSON.parse(options.body));
                return { ok: true, async json() { return { choices: [{ message: { content: responses[workflow] } }] }; } };
            },
        }));

        for (const [maxTokens, temperature] of [[undefined, undefined], [null, null], [8192, 0]]) {
            await invoke(workflow, providers, maxTokens, temperature);
            const body = calls.at(-1);
            assert.equal(Object.hasOwn(body, 'max_tokens'), maxTokens != null);
            if (maxTokens != null) assert.equal(body.max_tokens, maxTokens);
            assert.equal(body.model, 'helper');
            assert.ok(body.messages.length > 0);
            assert.equal(Object.hasOwn(body, 'temperature'), temperature != null);
            if (temperature != null) assert.equal(body.temperature, temperature);
        }
        assert.equal(calls.length, 3);
    });
}
