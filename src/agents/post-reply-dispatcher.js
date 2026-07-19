export function createPostReplyDispatcher({ runtime, settings, logger } = {}) {
    if (!runtime?.enqueueMany) throw new TypeError('Post-reply dispatcher requires a batch-capable helper runtime.');

    function dispatch(payload = {}) {
        if (!settings.enableHelperAgents) return [];

        const requests = [];
        const dedupeBase = payload.chatId && payload.messageId
            ? `${payload.chatId}:${payload.messageId}`
            : null;

        if (settings.helperMemoryAfterReply) {
            requests.push({
                agent: 'memory',
                payload: {
                    input: payload.input,
                    sources: payload.sources,
                    context: payload.context,
                },
                dedupeKey: dedupeBase ? `memory:${dedupeBase}` : null,
                priority: 50,
                metadata: { trigger: 'post-reply', batch: dedupeBase },
            });
        }

        if (settings.helperSummaryAfterReply) {
            requests.push({
                agent: 'summary',
                payload,
                dedupeKey: dedupeBase ? `summary:${dedupeBase}` : null,
                priority: 40,
                metadata: { trigger: 'post-reply', batch: dedupeBase },
            });
        }

        if (settings.helperLoreAfterReply) {
            requests.push({
                agent: 'lore',
                payload,
                dedupeKey: dedupeBase ? `lore:${dedupeBase}` : null,
                priority: 30,
                metadata: { trigger: 'post-reply', batch: dedupeBase },
            });
        }

        if (!requests.length) return [];

        const jobs = runtime.enqueueMany(requests);
        logger?.debug('Dispatched concurrent post-reply helper batch.', {
            count: jobs.length,
            agents: requests.map(request => request.agent),
        });
        return jobs;
    }

    return Object.freeze({ dispatch });
}
