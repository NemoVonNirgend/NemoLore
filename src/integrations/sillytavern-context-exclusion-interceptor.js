export function createSillyTavernContextExclusionInterceptor({
    policy,
    summaryStore,
    getChatId,
    getContext,
    next,
    logger,
} = {}) {
    if (!policy?.apply) throw new TypeError('Context exclusion interceptor requires a policy.');

    return async function intercept(chat, contextSize, abort, type) {
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
        const ignoreSymbol = getContext?.()?.symbols?.ignore;
        if (ignoreSymbol && Array.isArray(chat)) {
            for (let index = 0; index < result.hiddenCount; index += 1) {
                chat[index] = structuredClone(chat[index]);
                chat[index].extra ??= {};
                chat[index].extra[ignoreSymbol] = true;
            }
            return typeof next === 'function' ? next(chat, contextSize, abort, type) : undefined;
        }
        return typeof next === 'function' ? next(result.visible, contextSize, abort, type) : undefined;
    };
}
