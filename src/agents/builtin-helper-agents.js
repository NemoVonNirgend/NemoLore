export function createMemoryHelperAgent({ pipeline } = {}) {
    if (!pipeline?.ingest) throw new TypeError('Memory helper agent requires a memory pipeline.');

    return Object.freeze({
        async run(job) {
            const payload = job.payload ?? {};
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
                results.push(...await pipeline.ingest({
                    extractor,
                    input: payload.input,
                    sources: payload.sources ?? [],
                    context,
                }));
            }

            return { memoryIds: results.map(record => record.id), records: results };
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
