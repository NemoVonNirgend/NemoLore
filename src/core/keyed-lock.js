export function createKeyedLock() {
    const tails = new Map();

    async function run(key, operation) {
        const normalizedKey = String(key ?? 'default');
        const previous = tails.get(normalizedKey) ?? Promise.resolve();
        let release;
        const current = new Promise(resolve => { release = resolve; });
        tails.set(normalizedKey, previous.then(() => current));

        await previous;
        try {
            return await operation();
        } finally {
            release();
            if (tails.get(normalizedKey) === current) tails.delete(normalizedKey);
        }
    }

    return Object.freeze({ run, has: key => tails.has(String(key ?? 'default')) });
}
