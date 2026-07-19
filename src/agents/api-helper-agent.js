export function createApiHelperAgent({ generation, tasks, logger } = {}) {
    if (!generation?.generate) throw new TypeError('API helper agent requires a generation service.');
    if (!tasks) throw new TypeError('API helper agent requires a task registry.');

    return Object.freeze({
        async run(job, context = {}) {
            const taskName = job.payload?.task;
            const task = tasks.get(taskName);
            if (!task) throw new Error(`Unknown helper task: ${taskName}`);

            const request = await task.buildRequest(job.payload, context);
            const result = await generation.generate(request, {
                provider: job.payload.provider,
            });

            const applied = typeof task.applyResult === 'function'
                ? await task.applyResult(result, job.payload, context)
                : result;

            logger?.debug('API helper task completed.', {
                jobId: job.id,
                task: taskName,
                provider: result.provider,
            });

            return {
                task: taskName,
                generation: result,
                output: applied,
            };
        },
    });
}
