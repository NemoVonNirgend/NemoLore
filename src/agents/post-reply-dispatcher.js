export function createPostReplyDispatcher({ runtime, settings, policy, providerRouter, logger } = {}) {
    if (!runtime?.enqueueMany) throw new TypeError('Post-reply dispatcher requires a batch-capable helper runtime.');

    function requestFor(workflow, payload, dedupeBase) {
        const provider = providerRouter?.routeFor?.(workflow) ?? null;
        const common = { chatId: payload.chatId, messageId: payload.messageId, provider };

        if (workflow === 'memory') {
            return {
                agent: 'memory',
                payload: { ...common, messageCount: payload.messageCount, input: payload.input, sources: payload.sources, context: payload.context, provider },
                dedupeKey: dedupeBase ? `memory:${dedupeBase}` : null,
                priority: 50,
                metadata: { trigger: 'post-reply', batch: dedupeBase, workflow, provider },
            };
        }

        return {
            agent: workflow,
            payload: { ...payload, provider },
            dedupeKey: dedupeBase ? `${workflow}:${dedupeBase}` : null,
            priority: workflow === 'summary' ? 40 : 30,
            metadata: { trigger: 'post-reply', batch: dedupeBase, workflow, provider },
        };
    }

    function dispatch(payload = {}) {
        if (!settings.enableHelperAgents) return [];
        const dedupeBase = payload.chatId && payload.messageId ? `${payload.chatId}:${payload.messageId}` : null;
        const scheduling = policy?.select?.(payload, { allowWorkflow: engineAllows }) ?? {
            selected: ['memory', 'summary', 'lore']
                .filter(workflow => settings[`helper${workflow[0].toUpperCase()}${workflow.slice(1)}AfterReply`])
                .map(workflow => ({ workflow })),
            decisions: [],
        };
        const selected = scheduling.selected;
        const requests = selected.map(item => requestFor(item.workflow, payload, dedupeBase));
        if (!requests.length) {
            logger?.debug('No post-reply helper jobs passed scheduling policy.', {
                decisions: scheduling.decisions,
            });
            return [];
        }

        const jobs = runtime.enqueueMany(requests);
        logger?.debug('Dispatched concurrent post-reply helper batch.', {
            count: jobs.length,
            agents: requests.map(request => request.agent),
            decisions: scheduling.decisions,
        });
        return jobs;
    }

    return Object.freeze({
        dispatch,
        inspectPolicy: payload => policy?.select?.(payload, { allowWorkflow: engineAllows }) ?? null,
    });
}
