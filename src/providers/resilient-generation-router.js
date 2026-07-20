function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label) {
    if (!timeoutMs || timeoutMs <= 0) return promise;
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
    ]).finally(() => clearTimeout(timer));
}

export function createResilientGenerationRouter({ registry, settings, logger, clock = Date } = {}) {
    if (!registry?.generate) throw new TypeError('Generation router requires a provider registry.');

    const failures = new Map();

    function routeFor(workflow, explicitProvider) {
        if (explicitProvider) return explicitProvider;
        const overrideKey = {
            memory: 'helperMemoryProvider',
            summary: 'helperSummaryProvider',
            lore: 'helperLoreProvider',
        }[workflow];
        return (overrideKey && settings?.[overrideKey])
            || settings?.helperAgentProvider
            || registry.activeProvider;
    }

    function fallbackFor(primary) {
        const fallback = settings?.helperFallbackProvider;
        return fallback && fallback !== primary ? fallback : null;
    }

    function circuitOpen(provider) {
        const state = failures.get(provider);
        if (!state) return false;
        const threshold = Math.max(1, Number(settings?.helperCircuitBreakerFailures ?? 3));
        const cooldown = Math.max(0, Number(settings?.helperCircuitBreakerCooldownMs ?? 60_000));
        return state.count >= threshold && clock.now() - state.lastFailureAt < cooldown;
    }

    function recordFailure(provider) {
        const current = failures.get(provider) ?? { count: 0, lastFailureAt: 0 };
        failures.set(provider, { count: current.count + 1, lastFailureAt: clock.now() });
    }

    function recordSuccess(provider) {
        failures.delete(provider);
    }

    async function attempt(input, provider, options) {
        if (!provider) throw new Error('No generation provider is configured.');
        if (!registry.has(provider)) throw new Error(`Generation provider is unavailable: ${provider}`);
        if (circuitOpen(provider)) throw new Error(`Generation provider circuit is open: ${provider}`);

        const retries = Math.max(0, Number(options.retries ?? settings?.helperRetryCount ?? 1));
        const timeoutMs = Math.max(0, Number(options.timeoutMs ?? settings?.helperRequestTimeoutMs ?? 45_000));
        let lastError;

        for (let attemptIndex = 0; attemptIndex <= retries; attemptIndex += 1) {
            try {
                const result = await withTimeout(
                    registry.generate(input, { provider }),
                    timeoutMs,
                    `${provider} generation`,
                );
                recordSuccess(provider);
                return result;
            } catch (error) {
                lastError = error;
                recordFailure(provider);
                logger?.warn('Helper generation attempt failed.', {
                    provider,
                    attempt: attemptIndex + 1,
                    error,
                });
                if (attemptIndex < retries) await delay(Math.min(1000, 150 * (attemptIndex + 1)));
            }
        }

        throw lastError;
    }

    async function generate(input, options = {}) {
        const workflow = options.workflow ?? input?.metadata?.task ?? 'helper';
        const primary = routeFor(workflow, options.provider);
        const fallback = options.fallbackProvider ?? fallbackFor(primary);

        try {
            return await attempt(input, primary, options);
        } catch (primaryError) {
            if (!fallback) throw primaryError;
            logger?.warn('Falling back to alternate helper provider.', { workflow, primary, fallback });
            return attempt(input, fallback, { ...options, retries: 0 });
        }
    }

    return Object.freeze({
        generate,
        routeFor,
        inspect: () => Object.freeze({
            routes: {
                shared: settings?.helperAgentProvider || null,
                memory: routeFor('memory'),
                summary: routeFor('summary'),
                lore: routeFor('lore'),
                fallback: settings?.helperFallbackProvider || null,
            },
            failures: Object.fromEntries(failures),
        }),
        resetCircuit(provider) {
            if (provider) failures.delete(provider);
            else failures.clear();
        },
    });
}
