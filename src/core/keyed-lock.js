export function createKeyedLock() {
    const tails = new Map();

    async function run(key, operation) {
        const normalizedKey = String(key ?? 'default');
        const previous = tails.get(normalizedKey) ?? Promise.resolve();
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const tail = previous.then(() => gate);
        tails.set(normalizedKey, tail);

        await previous;
        try {
            return await operation();
        } finally {
            release();
            if (tails.get(normalizedKey) === tail) tails.delete(normalizedKey);
        }
    }

    return Object.freeze({ run, has: key => tails.has(String(key ?? 'default')) });
}
