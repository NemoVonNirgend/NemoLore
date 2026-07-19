import {
    assertGenerationProvider,
    createGenerationRequest,
    normalizeGenerationResult,
} from './generation-provider.js';

function now() {
    return globalThis.performance?.now?.() ?? Date.now();
}

export function createProviderRegistry({ logger, defaultProvider = null } = {}) {
    const providers = new Map();
    let activeProvider = defaultProvider;

    function register(name, provider) {
        if (!name) throw new TypeError('Provider name is required.');
        providers.set(name, assertGenerationProvider(provider, name));
        if (!activeProvider) activeProvider = name;
        logger?.debug('Registered generation provider.', { name });
        return provider;
    }

    function unregister(name) {
        const removed = providers.delete(name);
        if (activeProvider === name) activeProvider = providers.keys().next().value ?? null;
        return removed;
    }

    function setActive(name) {
        if (!providers.has(name)) throw new Error(`Unknown generation provider: ${name}`);
        activeProvider = name;
    }

    function get(name = activeProvider) {
        if (!name) throw new Error('No generation provider is active.');
        const provider = providers.get(name);
        if (!provider) throw new Error(`Unknown generation provider: ${name}`);
        return provider;
    }

    async function generate(input, options = {}) {
        const providerName = options.provider ?? activeProvider;
        const provider = get(providerName);
        const request = createGenerationRequest(input);
        const startedAt = now();

        try {
            const result = await provider.generate(request);
            logger?.debug('Generation completed.', {
                provider: providerName,
                durationMs: Math.round(now() - startedAt),
            });
            return normalizeGenerationResult(result, providerName);
        } catch (error) {
            logger?.error('Generation failed.', { provider: providerName, error });
            throw error;
        }
    }

    return Object.freeze({
        register,
        unregister,
        setActive,
        get,
        generate,
        has: name => providers.has(name),
        list: () => [...providers.keys()],
        get activeProvider() { return activeProvider; },
    });
}
