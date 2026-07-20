import { createActiveChatGuard } from '../core/active-chat-guard.js';

<<<<<<< HEAD
export function createMemoryHelperAgent({ pipeline, getActiveChatId } = {}) {
=======
export function createMemoryHelperAgent({ pipeline, maintenance, getActiveChatId } = {}) {
>>>>>>> dev/preset-architecture
    if (!pipeline?.ingest) throw new TypeError('Memory helper agent requires a memory pipeline.');

    return Object.freeze({
        async run(job) {
            const payload = job.payload ?? {};
            const shouldCommit = createActiveChatGuard(getActiveChatId, payload.chatId);
<<<<<<< HEAD
            if (!shouldCommit()) return { skipped: true, reason: 'chat-changed', memoryIds: [], records: [] };
=======
            if (!shouldCommit()) return { skipped: true, reason: 'chat-changed', memoryIds: [], records: [], maintenance: null };
>>>>>>> dev/preset-architecture
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
<<<<<<< HEAD
                if (!shouldCommit()) return { skipped: true, reason: 'chat-changed', memoryIds: [], records: [] };
=======
                if (!shouldCommit()) return { skipped: true, reason: 'chat-changed', memoryIds: [], records: [], maintenance: null };
>>>>>>> dev/preset-architecture
                results.push(...await pipeline.ingest({
                    extractor,
                    input: payload.input,
                    sources: payload.sources ?? [],
                    context,
                    shouldCommit,
                }));
<<<<<<< HEAD
                if (!shouldCommit()) return { skipped: true, reason: 'chat-changed', memoryIds: [], records: [] };
=======
                if (!shouldCommit()) return { skipped: true, reason: 'chat-changed', memoryIds: [], records: [], maintenance: null };
>>>>>>> dev/preset-architecture
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
