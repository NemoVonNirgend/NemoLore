export function createSillyTavernContextExclusionInterceptor({
    policy,
    summaryStore,
    getChatId,
    compatibility,
    next,
    logger,
} = {}) {
    if (!policy?.apply) throw new TypeError('Context exclusion interceptor requires a policy.');

    return async function intercept(chat, contextSize, abort, type) {
        if (typeof next !== 'function') return undefined;
        if (compatibility?.mode?.() !== 'modular') {
            return next(chat, contextSize, abort, type);
        }

        const chatId = getChatId?.();
        const summary = chatId ? summaryStore?.get?.(chatId) : null;
        const result = policy.apply(Array.isArray(chat) ? chat : [], {
            summaryAvailable: Boolean(summary?.text),
        });

        logger?.debug('Applied modular summary context window.', {
            chatId,
            hiddenCount: result.hiddenCount,
            visibleCount: result.visibleCount,
        });
        return next(result.visible, contextSize, abort, type);
    };
}
