export function createHelperTaskRegistry({ logger } = {}) {
    const tasks = new Map();

    function register(name, task) {
        if (!name || typeof task?.buildRequest !== 'function') {
            throw new TypeError('Helper task requires a name and buildRequest(payload, context) method.');
        }
        tasks.set(name, Object.freeze({ name, ...task }));
        logger?.debug('Registered helper task.', { name });
        return task;
    }

    return Object.freeze({
        register,
        unregister: name => tasks.delete(name),
        get: name => tasks.get(name) ?? null,
        has: name => tasks.has(name),
        list: () => [...tasks.keys()],
    });
}
