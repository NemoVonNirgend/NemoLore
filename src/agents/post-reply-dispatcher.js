export function createPostReplyDispatcher({ runtime, settings, logger } = {}) {
    if (!runtime?.enqueue) throw new TypeError('Post-reply dispatcher requires a helper runtime.');

    function dispatch(payload = {}) {
        if (!settings.enableHelperAgents) return [];
        const jobs = [];
        const dedupeBase = payload.chatId && payload.messageId
            ? `${payload.chatId}:${payload.messageId}`
            : null;

        if (settings.helperMemoryAfterReply) {
            jobs.push(runtime.enqueue({
                agent: 'memory',
                payload: {
                    input: payload.input,
                    sources: payload.sources,
                    context: payload.context,
                },
                dedupeKey: dedupeBase ? `memory:${dedupeBase}` : null,
                priority: 50,
                metadata: { trigger: 'post-reply' },
            }));
        }

        if (settings.helperLoreAfterReply) {
            jobs.push(runtime.enqueue({
                agent: 'lore',
                payload,
                dedupeKey: dedupeBase ? `lore:${dedupeBase}` : null,
                priority: 30,
                metadata: { trigger: 'post-reply' },
            }));
        }

        if (settings.helperSummaryAfterReply) {
            jobs.push(runtime.enqueue({
                agent: 'summary',
                payload,
                dedupeKey: dedupeBase ? `summary:${dedupeBase}` : null,
                priority: 40,
                metadata: { trigger: 'post-reply' },
            }));
        }

        logger?.debug('Dispatched post-reply helper jobs.', { count: jobs.length });
        return jobs;
    }

    return Object.freeze({ dispatch });
}
