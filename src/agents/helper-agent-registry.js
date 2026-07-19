export function createHelperAgentRegistry({ logger } = {}) {
    const agents = new Map();

    function register(name, agent) {
        if (!name || typeof agent?.run !== 'function') {
            throw new TypeError('Helper agent requires a name and run(job, context) method.');
        }
        agents.set(name, Object.freeze({ name, ...agent }));
        logger?.debug('Registered helper agent.', { name });
        return agent;
    }

    return Object.freeze({
        register,
        unregister: name => agents.delete(name),
        get: name => agents.get(name) ?? null,
        has: name => agents.has(name),
        list: () => [...agents.keys()],
    });
}
