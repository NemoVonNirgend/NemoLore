export function createContextRegistry({ logger } = {}) {
    const contributors = new Map();

    function register(name, contributor) {
        if (!name || typeof contributor?.contribute !== 'function') {
            throw new TypeError('Context contributor requires a name and contribute(request) method.');
        }
        contributors.set(name, contributor);
        logger?.debug('Registered context contributor.', { name });
        return contributor;
    }

    function unregister(name) {
        return contributors.delete(name);
    }

    function get(name) {
        return contributors.get(name) ?? null;
    }

    return Object.freeze({
        register,
        unregister,
        get,
        has: name => contributors.has(name),
        list: () => [...contributors.keys()],
    });
}
