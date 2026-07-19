export function createSillyTavernGenerationOrchestrator({
    contextBridge,
    postReply,
    requestFactory,
    next,
    logger,
} = {}) {
    if (!contextBridge?.refresh) throw new TypeError('Generation orchestrator requires a context bridge.');
    if (typeof requestFactory !== 'function') throw new TypeError('Generation orchestrator requires a request factory.');

    return async function orchestrate(chat, contextSize, abort, type) {
        const request = await requestFactory({ chat, contextSize, abort, type });

        try {
            await contextBridge.refresh(request.contextRequest ?? request, request.contextOptions ?? {});
        } catch (error) {
            logger?.error('Pre-generation context refresh failed.', error);
            if (request.failFastContext) throw error;
        }

        const foregroundResult = typeof next === 'function'
            ? await next(chat, contextSize, abort, type)
            : undefined;

        try {
            postReply?.dispatch({
                ...(request.postReply ?? request),
                foregroundResult,
            });
        } catch (error) {
            logger?.error('Unable to dispatch post-reply helper work.', error);
        }

        return foregroundResult;
    };
}
