import { createHelperJob, HELPER_JOB_STATUS } from './helper-job.js';

export function createHelperAgentRuntime({ registry, logger, concurrency = 2, contextFactory } = {}) {
    if (!registry) throw new TypeError('Helper agent runtime requires a registry.');

    const jobs = new Map();
    const queue = [];
    const dedupeKeys = new Map();
    const listeners = new Set();
    let running = 0;

    function emit(event, job) {
        for (const listener of listeners) {
            try { listener(event, snapshot(job)); } catch (error) { logger?.error('Helper listener failed.', error); }
        }
    }

    function snapshot(job) {
        if (!job) return null;
        const { controller, ...safe } = job;
        return Object.freeze(structuredClone(safe));
    }

    function sortQueue() {
        queue.sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
    }

    async function execute(job) {
        const agent = registry.get(job.agent);
        job.status = HELPER_JOB_STATUS.RUNNING;
        job.startedAt = new Date().toISOString();
        running += 1;
        emit('started', job);

        try {
            const context = (await contextFactory?.(job)) ?? {};
            job.result = await agent.run(snapshot(job), {
                ...context,
                signal: job.controller.signal,
            });
            job.status = HELPER_JOB_STATUS.SUCCEEDED;
            emit('succeeded', job);
        } catch (error) {
            job.error = { name: error?.name ?? 'Error', message: error?.message ?? String(error) };
            job.status = job.controller.signal.aborted
                ? HELPER_JOB_STATUS.CANCELLED
                : HELPER_JOB_STATUS.FAILED;
            emit(job.status, job);
            logger?.error('Helper agent job failed.', { id: job.id, agent: job.agent, error });
        } finally {
            job.completedAt = new Date().toISOString();
            running -= 1;
            if (job.dedupeKey && job.status !== HELPER_JOB_STATUS.SUCCEEDED) {
                dedupeKeys.delete(job.dedupeKey);
            }
            drain();
        }
    }

    function drain() {
        while (running < concurrency && queue.length) {
            const job = queue.shift();
            if (job.status === HELPER_JOB_STATUS.CANCELLED) continue;
            void execute(job);
        }
    }

    function prepare(input) {
        if (!registry.has(input?.agent)) throw new Error(`Unknown helper agent: ${input?.agent}`);
        if (input.dedupeKey && dedupeKeys.has(input.dedupeKey)) {
            return { snapshot: snapshot(jobs.get(dedupeKeys.get(input.dedupeKey))) };
        }

        const job = createHelperJob(input);
        jobs.set(job.id, job);
        if (job.dedupeKey) dedupeKeys.set(job.dedupeKey, job.id);
        queue.push(job);
        emit('queued', job);
        return { job, snapshot: snapshot(job) };
    }

    function enqueue(input) {
        const prepared = prepare(input);
        if (prepared.job) sortQueue();
        queueMicrotask(drain);
        return prepared.snapshot;
    }

    function enqueueMany(inputs = []) {
        const snapshots = [];
        let added = false;

        for (const input of inputs) {
            const prepared = prepare(input);
            snapshots.push(prepared.snapshot);
            added ||= Boolean(prepared.job);
        }

        if (added) sortQueue();
        queueMicrotask(drain);
        logger?.debug('Queued helper job batch.', { count: snapshots.length, concurrency });
        return Object.freeze(snapshots);
    }

    function cancel(id, reason = 'cancelled') {
        const job = jobs.get(id);
        if (!job || [HELPER_JOB_STATUS.SUCCEEDED, HELPER_JOB_STATUS.FAILED, HELPER_JOB_STATUS.CANCELLED].includes(job.status)) return false;
        job.metadata.cancelReason = reason;
        job.controller.abort(reason);
        if (job.status === HELPER_JOB_STATUS.QUEUED) {
            job.status = HELPER_JOB_STATUS.CANCELLED;
            job.completedAt = new Date().toISOString();
            if (job.dedupeKey) dedupeKeys.delete(job.dedupeKey);
            emit('cancelled', job);
        }
        return true;
    }

    function subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    return Object.freeze({
        enqueue,
        enqueueMany,
        cancel,
        subscribe,
        get: id => snapshot(jobs.get(id)),
        list: () => [...jobs.values()].map(snapshot),
        inspect: () => Object.freeze({ running, queued: queue.length, concurrency }),
    });
}
