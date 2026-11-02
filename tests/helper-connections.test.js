import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettings, selectPreset } from '../src/core/settings.js';
import { createSillyTavernHelperConnections, SAVED_HELPER_PROVIDER } from '../src/integrations/sillytavern-helper-connections.js';
import { createProviderRegistry } from '../src/providers/provider-registry.js';
import { createResilientGenerationRouter } from '../src/providers/resilient-generation-router.js';

function fixture(overrides = {}) {
    const settings = createSettings({ settingsSchemaVersion: 2, helperAgentProvider: SAVED_HELPER_PROVIDER, helperConnectionSource: 'vertexai', helperConnectionModel: 'gemini-4-argon' });
    const native = {
        chat_completion_source: 'openai', openai_model: 'chat-model', openai_max_tokens: 1200,
        vertexai_model: 'gemini-3.8-flash', google_model: 'gemini-studio',
        vertexai_auth_mode: 'full', vertexai_region: 'global', vertexai_express_project_id: 'saved-project',
        reverse_proxy: 'https://chat-proxy.invalid', proxy_password: 'chat-only-password',
        custom_url: 'https://saved-custom.invalid/v1', custom_include_headers: 'x-custom: configured',
        stream_openai: true, function_calling: true, bias_presets: { test: [] },
    };
    const calls = [];
    const options = {
        settings, getSettings: () => native,
        getSources: () => ['vertexai', 'makersuite', 'openai', 'groq', 'custom'].map(id => ({ id, label: id })),
        getModelOptions: source => [{ id: `${source}-catalogue`, label: 'Catalogue model' }, { id: '', label: 'placeholder' }],
        getActiveModels: () => [{ id: 'active-openai-only' }],
        secretKeys: { VERTEXAI_SERVICE_ACCOUNT: 'service-account', VERTEXAI: 'vertex-key', MAKERSUITE: 'studio-key' },
        getSecretState: () => ({
            'service-account': [{ id: 'account-id', active: true, value: 'NEVER-COPY-ME' }],
            'vertex-key': [{ id: 'express-id', active: true, value: 'NEVER-COPY-ME' }],
            'studio-key': true,
        }),
        getResponseLimit: () => 64000,
        createParameters: async (snapshot, model, type, messages) => {
            calls.push({ snapshot, model, type, messages });
            // Emulate ST's source-specific serializer, including its wrapper return value.
            return { generate_data: {
                chat_completion_source: snapshot.chat_completion_source, model, messages,
                max_tokens: snapshot.openai_max_tokens, vertexai_auth_mode: snapshot.vertexai_auth_mode,
                vertexai_region: snapshot.vertexai_region, vertexai_express_project_id: snapshot.vertexai_express_project_id,
                reverse_proxy: snapshot.reverse_proxy, stop: ['chat-stop'],
            } };
        },
        sendRequest: async (payload, signal) => { calls.push({ payload, signal }); return { content: 'helper output' }; },
        ...overrides,
    };
    return { settings, native, calls, service: createSillyTavernHelperConnections(options) };
}

test('saved Vertex helpers reuse service-account auth and visible response length without changing chat settings', async () => {
    const { service, native, settings, calls } = fixture();
    const before = structuredClone(native);
    const registry = createProviderRegistry();
    registry.register(SAVED_HELPER_PROVIDER, service);
    const router = createResilientGenerationRouter({ registry, settings });
    const signal = new AbortController().signal;
    const result = await router.generate({ messages: [{ role: 'user', content: 'Extract facts' }], signal }, { workflow: 'memory' });
    assert.equal(result.text, 'helper output');
    assert.equal(calls[0].type, 'quiet');
    assert.equal(calls[0].snapshot.function_calling, false);
    assert.equal(calls[0].snapshot.stream_openai, false);
    assert.equal(calls[1].payload.model, 'gemini-4-argon');
    assert.equal(calls[1].payload.chat_completion_source, 'vertexai');
    assert.equal(calls[1].payload.vertexai_auth_mode, 'full');
    assert.equal(calls[1].payload.vertexai_region, 'global');
    assert.equal(calls[1].payload.secret_id, 'account-id');
    assert.equal(calls[1].payload.max_tokens, 64000);
    assert.equal(calls[1].payload.stream, false);
    assert.equal(calls[1].payload.stop, undefined);
    assert.ok(calls[1].signal instanceof AbortSignal);
    assert.equal(calls[1].signal.aborted, false);
    assert.deepEqual(native, before);
    assert.equal(calls[1].payload.reverse_proxy, '');
    assert.ok(!JSON.stringify(calls).includes('NEVER-COPY-ME'));
    assert.ok(!JSON.stringify(settings).includes('NEVER-COPY-ME'));
});

test('Vertex Express uses its saved key ID and project; explicit budgets and model overrides remain supported', async () => {
    const { service, native, calls } = fixture();
    native.vertexai_auth_mode = 'express';
    await service.generate({ messages: [{ role: 'user', content: 'Summarize' }], model: 'gemini-3.8-flash', maxTokens: 12000, temperature: 0.5, stop: ['END'] });
    assert.equal(calls[1].payload.secret_id, 'express-id');
    assert.equal(calls[1].payload.vertexai_express_project_id, 'saved-project');
    assert.equal(calls[1].payload.max_tokens, 12000);
    assert.equal(calls[1].payload.model, 'gemini-3.8-flash');
    assert.deepEqual(calls[1].payload.stop, ['END']);
    assert.equal(calls[0].snapshot.temp_openai, 0.5);
});

test('helper temperature inherits native settings or a helper override without changing foreground sampling', async () => {
    const { service, native, calls, settings } = fixture();
    native.temp_openai = 1;
    const registry = createProviderRegistry();
    registry.register(SAVED_HELPER_PROVIDER, service);
    const router = createResilientGenerationRouter({ registry, settings });
    for (const [configured, explicit, expected] of [[null, null, 1], [0.4, null, 0.4], [0.4, 0, 0], [null, 0.8, 0.8]]) {
        settings.helperTemperature = configured;
        await router.generate({ prompt: 'Extract facts', temperature: explicit });
        assert.equal(calls.at(-2).snapshot.temp_openai, expected);
        assert.equal(native.temp_openai, 1);
    }
    await service.generateCurrent({ messages: [{ role: 'user', content: 'Current connection helper' }], temperature: 0.6 });
    assert.equal(calls.at(-2).snapshot.temp_openai, 0.6);
    assert.equal(calls.at(-1).payload.model, 'chat-model');
    assert.equal(calls.at(-1).payload.chat_completion_source, 'openai');
    assert.equal(native.temp_openai, 1);
});

test('models combine the source catalogue and saved custom ID without leaking the active source list', () => {
    const { service } = fixture();
    assert.deepEqual(service.models('vertexai').map(model => model.id), ['vertexai-catalogue', 'gemini-3.8-flash', 'gemini-4-argon']);
    assert.ok(service.models('openai').some(model => model.id === 'active-openai-only'));
    assert.equal(service.defaultModel('makersuite'), 'gemini-studio');
    assert.match(service.describe('vertexai').credentials, /saved/);
    assert.match(service.describe('vertexai').endpoint, /global/);
    assert.equal(service.describe('vertexai').canRefresh, false);
});

test('following the current OpenRouter connection preserves its website-model selection', async () => {
    const { service, native, calls } = fixture({ getSources: () => [{ id: 'openrouter', label: 'OpenRouter' }] });
    native.chat_completion_source = 'openrouter';
    native.openrouter_model = 'OR_Website';
    await service.generateCurrent({ messages: [{ role: 'user', content: 'Task' }] });
    assert.equal(calls[1].payload.model, null);
    assert.equal(calls[0].snapshot.openrouter_model, 'OR_Website');
    assert.equal(native.openrouter_model, 'OR_Website');
});

test('Vertex model refresh reloads ST catalogue without calling an unsupported listing endpoint', async () => {
    const { service } = fixture({ fetchImpl: () => { throw new Error('Unexpected HTTP request'); } });
    assert.ok((await service.refreshModels('vertexai')).some(model => model.id === 'gemini-4-argon'));
});

test('model-list requests use ST backend credentials and only connection fields, keeping helper selection unchanged', async () => {
    const requests = [];
    const { service, settings, native } = fixture({
        fetchImpl: async (url, init) => {
            requests.push({ url, init });
            return { ok: true, json: async () => ({ data: [{ id: 'account-model', name: 'Account model' }] }) };
        },
        getRequestHeaders: () => ({ 'X-CSRF-Token': 'test-token' }),
    });
    const before = structuredClone(settings);
    native.prompts = ['private chat prompts'];
    const models = await service.refreshModels('custom');
    assert.equal(requests[0].url, '/api/backends/chat-completions/status');
    assert.equal(requests[0].init.headers['X-CSRF-Token'], 'test-token');
    assert.deepEqual(JSON.parse(requests[0].init.body), {
        chat_completion_source: 'custom', custom_url: native.custom_url, custom_include_headers: native.custom_include_headers,
    });
    assert.ok(models.some(model => model.id === 'account-model' && model.label === 'Account model'));
    assert.deepEqual(settings, before);
});

test('a failed refresh preserves catalogue and saved helper model', async () => {
    const { service, settings } = fixture({ fetchImpl: async () => ({ ok: false, json: async () => ({ error: true }) }) });
    const before = service.models('makersuite');
    await assert.rejects(service.refreshModels('makersuite'), /Could not refresh/);
    assert.deepEqual(service.models('makersuite'), before);
    assert.equal(settings.helperConnectionModel, 'gemini-4-argon');
});

test('helper connection survives settings serialization and profile changes', async () => {
    const first = fixture();
    const restored = createSettings(JSON.parse(JSON.stringify(first.settings)));
    Object.assign(restored, selectPreset(restored, 'epic'));
    const second = fixture({ settings: restored });
    await second.service.generate({ messages: [{ role: 'user', content: 'Extract' }] });
    assert.equal(second.calls[1].payload.model, 'gemini-4-argon');
    assert.equal(second.calls[1].payload.chat_completion_source, 'vertexai');
    assert.equal(restored.helperAgentProvider, SAVED_HELPER_PROVIDER);
});

test('concurrent native helpers have isolated settings and messages', async () => {
    const { service, calls, native } = fixture({ sendRequest: async () => ({ content: '{"ok":true}' }) });
    const before = structuredClone(native);
    const messages = [{ role: 'user', content: 'Task' }];
    await Promise.all([
        service.generate({ messages, maxTokens: 4000, prefill: '{' }),
        service.generate({ messages, maxTokens: 8000 }),
    ]);
    assert.equal(calls[0].snapshot.openai_max_tokens, 4000);
    assert.equal(calls[1].snapshot.openai_max_tokens, 8000);
    assert.equal(calls[0].messages.length, 2);
    assert.equal(calls[1].messages.length, 1);
    assert.equal(messages.length, 1);
    assert.deepEqual(native, before);
});

test('missing credentials are described without blocking keyless custom endpoints', async () => {
    const { service, settings } = fixture({ getSecretState: () => ({}) });
    settings.helperConnectionSource = 'custom';
    settings.helperConnectionModel = 'local-model';
    assert.match(service.describe('custom').credentials, /No saved credentials/);
    assert.equal((await service.generate({ messages: [] })).text, 'helper output');
});
