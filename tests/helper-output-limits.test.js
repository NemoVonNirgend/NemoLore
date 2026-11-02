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

async function invoke(workflow, generation, maxTokens) {
    if (workflow === 'memory') {
        return createEpisodeExtractor({ generation }).extract({
            input: 'The travellers reached the station.', context: { maxTokens },
        });
    }
    if (workflow === 'summary') {
        return createSummaryService({
            generation,
            store: createSummaryStore({ metadata: {}, saveMetadata: async () => {} }),
            settings: {},
        }).summarize({
            chatId: 'chat', messages: [{ id: '1', mes: 'The travellers reached the station.' }], maxTokens,
        });
    }
    return createLoreGenerationService({
        generation,
        lorebooks: {
            async ensureForChat() { return 'book'; },
            async load() { return { entries: {} }; },
        },
    }).preview({ chatId: 'chat', input: 'The travellers reached the station.', maxTokens });
}

for (const workflow of Object.keys(responses)) {
    test(`${workflow}: production SillyTavern route inherits the active limit unless explicitly overridden`, async () => {
        const calls = [];
        const providers = createProviderRegistry();
        // Exercise the actual bootstrap callback that maps maxTokens to responseLength.
        new Script(registration).runInNewContext({
            providers, createSillyTavernProvider, logger: undefined,
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

        for (const maxTokens of [undefined, null, 8192]) {
            await invoke(workflow, providers, maxTokens);
            const body = calls.at(-1);
            assert.equal(Object.hasOwn(body, 'max_tokens'), maxTokens != null);
            if (maxTokens != null) assert.equal(body.max_tokens, maxTokens);
            assert.equal(body.model, 'helper');
            assert.ok(body.messages.length > 0);
        }
        assert.equal(calls.length, 3);
    });
}
