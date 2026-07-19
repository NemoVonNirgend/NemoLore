export function createSillyTavernContextInterceptor({
    bridge,
    requestFactory = (...args) => ({ interceptorArgs: args }),
    next = null,
    logger,
} = {}) {
    if (!bridge?.refresh) {
        throw new TypeError('SillyTavern context interceptor requires a context bridge.');
    }
    if (typeof requestFactory !== 'function') {
        throw new TypeError('Context interceptor requestFactory must be a function.');
    }
    if (next != null && typeof next !== 'function') {
        throw new TypeError('Context interceptor next handler must be a function.');
    }

    return async function intercept(...args) {
        const request = await requestFactory(...args);
        try {
            await bridge.refresh(request ?? {}, request?.contextOptions ?? {});
        } catch (error) {
            logger?.error('Unable to refresh SillyTavern context before generation.', error);
            if (request?.failOnContextError) throw error;
        }

        return next ? next(...args) : undefined;
    };
}
