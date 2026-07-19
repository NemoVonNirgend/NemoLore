export const HELPER_JOB_STATUS = Object.freeze({
    QUEUED: 'queued',
    RUNNING: 'running',
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
});

function defaultIdFactory() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `helper-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createHelperJob(input, { idFactory = defaultIdFactory, now = () => new Date().toISOString() } = {}) {
    if (!input?.agent) throw new TypeError('Helper job requires an agent name.');

    return {
        id: input.id ?? idFactory(),
        agent: input.agent,
        payload: structuredClone(input.payload ?? {}),
        metadata: structuredClone(input.metadata ?? {}),
        dedupeKey: input.dedupeKey ?? null,
        priority: Number(input.priority ?? 0),
        status: HELPER_JOB_STATUS.QUEUED,
        createdAt: now(),
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
        controller: new AbortController(),
    };
}
