import { createActiveChatGuard } from '../core/active-chat-guard.js';

export function createMemoryHelperAgent({ pipeline, maintenance, getActiveChatId } = {}) {
    if (!pipeline?.ingest) throw new TypeError('Memory helper agent requires a memory pipeline.');

    return Object.freeze({
        async run(job) {
            const payload = job.payload ?? {};
            const shouldCommit = createActiveChatGuard(getActiveChatId, payload.chatId);
            if (!shouldCommit()) return { skipped: true, reason: 'chat-changed', memoryIds: [], records: [], maintenance: null };
            const extractorNames = payload.extractors ?? ['episode', 'atomic-fact', 'state-change'];
            const results = [];
            const context = {
                ...(payload.context ?? {}),
                generationOptions: {
                    ...(payload.context?.generationOptions ?? {}),
                    provider: payload.provider,
                    workflow: 'memory',
                },
            };

            for (const extractor of extractorNames) {
                if (!shouldCommit()) return { skipped: true, reason: 'chat-changed', memoryIds: [], records: [], maintenance: null };
                results.push(...await pipeline.ingest({
                    extractor,
                    input: payload.input,
                    sources: payload.sources ?? [],
                    context,
                    shouldCommit,
                }));
                if (!shouldCommit()) return { skipped: true, reason: 'chat-changed', memoryIds: [], records: [], maintenance: null };
            }

            if (!shouldCommit()) return { skipped: true, reason: 'chat-changed', memoryIds: [], records: [], maintenance: null };
            const maintenanceResult = await maintenance?.run?.({
                messageCount: payload.context?.chatLength ?? payload.messageCount,
                shouldCommit,
            });
            if (!shouldCommit()) return { skipped: true, reason: 'chat-changed', memoryIds: [], records: [], maintenance: null };

            return { memoryIds: results.map(record => record.id), records: results, maintenance: maintenanceResult ?? null };
        },
    });
}

export function createCallbackHelperAgent({ name, handler } = {}) {
    if (typeof handler !== 'function') throw new TypeError(`${name ?? 'Callback'} helper agent requires a handler.`);
    return Object.freeze({
        async run(job, context) {
            return handler(job.payload ?? {}, context, job);
        },
    });
}
