const MODEL_KEYS = Object.freeze({
    palm: 'google_model',
    vertexai: 'google_model',
});

function modelKey(source) {
    return MODEL_KEYS[source] ?? `${source}_model`;
}

export function createSillyTavernVectorAdapter({
    fetchImpl = globalThis.fetch,
    getRequestHeaders,
    getVectorSettings,
    logger,
} = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('Vector adapter requires fetch().');
    if (typeof getRequestHeaders !== 'function') throw new TypeError('Vector adapter requires SillyTavern request headers.');
    if (typeof getVectorSettings !== 'function') throw new TypeError('Vector adapter requires built-in Vector Storage settings.');

    function configuration() {
        const settings = getVectorSettings() ?? {};
        const source = String(settings.source ?? '').trim();
        if (!source) throw new Error('SillyTavern Vector Storage has no embedding source configured.');
        if (source === 'webllm' || source === 'koboldcpp') {
            throw new Error(`Vector source ${source} requires an in-process embedding bridge that is not exposed to third-party extensions.`);
        }
        const body = { source };
        const model = settings[modelKey(source)];
        if (model) body.model = model;
        if (settings.use_alt_endpoint && settings.alt_endpoint_url) body.apiUrl = settings.alt_endpoint_url;
        if (source === 'ollama') body.keep = Boolean(settings.ollama_keep);
        return body;
    }

    async function request(path, body) {
        const response = await fetchImpl(path, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ ...configuration(), ...body }),
        });
        if (!response.ok) throw new Error(`SillyTavern vector request failed (${response.status}) at ${path}.`);
        const contentType = response.headers?.get?.('content-type') ?? '';
        return contentType.includes('application/json') ? response.json() : null;
    }

    async function list(collectionId) {
        return await request('/api/vector/list', { collectionId }) ?? [];
    }

    async function insert(collectionId, items) {
        if (!items.length) return true;
        await request('/api/vector/insert', { collectionId, items });
        return true;
    }

    async function remove(collectionId, hashes) {
        if (!hashes.length) return true;
        await request('/api/vector/delete', { collectionId, hashes });
        return true;
    }

    async function query(collectionId, searchText, { topK = 5, threshold = 0.25 } = {}) {
        const result = await request('/api/vector/query', { collectionId, searchText, topK, threshold });
        return result ?? { hashes: [], metadata: [] };
    }

    function inspect() {
        try {
            const value = configuration();
            return Object.freeze({ available: true, source: value.source, model: value.model ?? null });
        } catch (error) {
            return Object.freeze({ available: false, source: null, model: null, reason: error.message });
        }
    }

    return Object.freeze({
        list,
        insert,
        remove,
        query,
        inspect,
        available() {
            try { configuration(); return true; } catch (error) { logger?.debug('Vector adapter unavailable.', { error }); return false; }
        },
    });
}
