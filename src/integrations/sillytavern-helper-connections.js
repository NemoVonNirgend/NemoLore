export const SAVED_HELPER_PROVIDER = 'st-saved';

const CATALOGUE_ONLY = new Set(['claude', 'ai21', 'vertexai', 'perplexity', 'zai', 'minimax']);
const STATUS_FIELDS = {
    custom: ['custom_url', 'custom_include_headers'],
    azure_openai: ['azure_base_url', 'azure_deployment_name', 'azure_api_version'],
    siliconflow: ['siliconflow_endpoint'],
    minimax: ['minimax_endpoint'],
    workers_ai: ['workers_ai_account_id'],
    pollinations: ['pollinations_endpoint'],
};

export function helperModelSetting(source) {
    return source === 'makersuite' ? 'google_model' : `${source}_model`;
}

function modelsFrom(items = []) {
    const models = new Map();
    for (const item of items) {
        const id = typeof item === 'string' ? item : item?.id ?? item?.value;
        if (!id || id === 'OR_Website' || item?.disabled) continue;
        models.set(id, { id, label: item?.name || item?.label || id });
    }
    return [...models.values()];
}

/** Uses ST's backend and secret IDs; never reads or copies a saved key value. */
export function createSillyTavernHelperConnections({
    settings, getSettings, getSources, getModelOptions, getActiveModels = () => [],
    getSecretState = () => ({}), secretKeys = {}, getResponseLimit = () => null,
    createParameters, sendRequest, fetchImpl = globalThis.fetch, getRequestHeaders = () => ({}),
} = {}) {
    const refreshed = new Map();

    function sources() {
        return getSources().filter(source => source.id && source.label);
    }

    function snapshot(source) {
        if (!sources().some(candidate => candidate.id === source)) throw new Error('Choose a SillyTavern helper provider.');
        const native = getSettings();
        const copy = structuredClone(native);
        // ST's proxy setting is shared between providers. Do not send it to an unrelated provider.
        if (source !== native.chat_completion_source) {
            copy.reverse_proxy = '';
            copy.proxy_password = '';
        }
        copy.chat_completion_source = source;
        return copy;
    }

    function credential(source, native = getSettings()) {
        const keyName = source === 'vertexai' && native.vertexai_auth_mode === 'full'
            ? 'VERTEXAI_SERVICE_ACCOUNT' : source.toUpperCase();
        const stored = (getSecretState() ?? {})[secretKeys[keyName]];
        const active = Array.isArray(stored) ? stored.find(entry => entry.active) : null;
        return { saved: Array.isArray(stored) ? stored.length > 0 : Boolean(stored), id: active?.id };
    }

    function models(source) {
        const native = getSettings();
        return modelsFrom([
            ...getModelOptions(source),
            ...(source === native.chat_completion_source ? getActiveModels() : []),
            ...(refreshed.get(source) ?? []),
            native[helperModelSetting(source)],
            ...(source === settings.helperConnectionSource ? [settings.helperConnectionModel] : []),
        ]);
    }

    function defaultModel(source) {
        const saved = getSettings()[helperModelSetting(source)];
        return saved && saved !== 'OR_Website' ? saved : models(source)[0]?.id ?? '';
    }

    function describe(source) {
        const native = snapshot(source);
        const auth = credential(source, native);
        const endpoint = source === 'custom' ? native.custom_url
            : source === 'azure_openai' ? native.azure_base_url
                : source === 'vertexai' ? `SillyTavern Vertex endpoint (${native.vertexai_region || 'default region'}, ${native.vertexai_auth_mode || 'express'} mode)`
                    : native[`${source}_endpoint`] || 'SillyTavern default endpoint';
        return {
            endpoint: endpoint || 'Set the endpoint in SillyTavern’s API Connections first.',
            credentials: native.reverse_proxy ? 'Using the current SillyTavern proxy connection.'
                : auth.saved ? 'Using credentials saved in SillyTavern.'
                    : 'No saved credentials detected. Configure this provider in SillyTavern’s API Connections first.',
            canRefresh: !CATALOGUE_ONLY.has(source),
        };
    }

    async function refreshModels(source, signal) {
        const native = snapshot(source);
        if (CATALOGUE_ONLY.has(source)) return models(source);
        const body = { chat_completion_source: source };
        for (const key of STATUS_FIELDS[source] ?? []) {
            if (native[key] != null) body[key] = native[key];
        }
        if (native.reverse_proxy) {
            body.reverse_proxy = native.reverse_proxy;
            body.proxy_password = native.proxy_password;
        }
        const { id } = credential(source, native);
        if (id) body.secret_id = id;
        const response = await fetchImpl('/api/backends/chat-completions/status', {
            method: 'POST', headers: getRequestHeaders(), cache: 'no-cache', body: JSON.stringify(body), signal,
        });
        const result = await response.json();
        if (!response.ok || result.error || !Array.isArray(result.data)) {
            throw new Error('Could not refresh models. Check this provider in SillyTavern’s API Connections.');
        }
        refreshed.set(source, modelsFrom(result.data));
        return models(source);
    }

    async function generate(request) {
        const source = settings.helperConnectionSource;
        const native = snapshot(source);
        const model = request.model || settings.helperConnectionModel || defaultModel(source);
        if (!model) throw new Error('Choose a helper model in NemoLore’s Helper connection settings.');
        if (!createParameters || !sendRequest) throw new Error('Update SillyTavern to use saved helper connections.');
        native[helperModelSetting(source)] = model;
        const responseLimit = request.maxTokens ?? Number(getResponseLimit() || native.openai_max_tokens);
        if (Number.isFinite(responseLimit) && responseLimit > 0) native.openai_max_tokens = responseLimit;
        if (request.temperature != null) native.temp_openai = request.temperature;
        Object.assign(native, { stream_openai: false, n: 1, function_calling: false, enable_web_search: false, request_images: false, bias_preset_selected: '' });
        const messages = structuredClone(request.messages);
        if (request.prefill) messages.push({ role: 'assistant', content: request.prefill });
        const { generate_data: payload } = await createParameters(native, model, 'quiet', messages);
        const { id } = credential(source, native);
        if (id) payload.secret_id = id;
        payload.stream = false;
        // Chat stop strings often truncate structured helper results. Only use an explicit helper stop.
        delete payload.stop;
        if (request.stop?.length) payload.stop = request.stop;
        const output = await sendRequest(payload, request.signal);
        let text = typeof output === 'string' ? output : output?.content;
        if (typeof text !== 'string') throw new TypeError('SillyTavern helper returned no text.');
        if (request.prefill && text.startsWith(request.prefill)) text = text.slice(request.prefill.length);
        return { text, model, raw: output };
    }

    return Object.freeze({ sources, models, defaultModel, describe, refreshModels, generate });
}
