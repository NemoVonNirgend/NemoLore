function assertFunction(name, value) {
    if (typeof value !== 'function') {
        throw new TypeError(`World info adapter requires ${name}().`);
    }
}

/**
 * Thin adapter around SillyTavern's world-info APIs.
 *
 * Keeping these functions behind an adapter prevents lore services from
 * depending on SillyTavern module globals or storage shapes directly.
 */
export function createWorldInfoAdapter({
    createWorld,
    deleteWorld,
    loadWorld,
    saveWorld,
    createEntry,
    updateWorldList,
    logger,
}) {
    assertFunction('createWorld', createWorld);
    assertFunction('loadWorld', loadWorld);
    assertFunction('saveWorld', saveWorld);
    assertFunction('createEntry', createEntry);

    async function create(name) {
        await createWorld(name);
        await updateWorldList?.();
        logger?.debug('Created world-info book.', { name });
        return name;
    }

    async function remove(name) {
        if (!deleteWorld) return false;
        await deleteWorld(name);
        await updateWorldList?.();
        logger?.debug('Deleted world-info book.', { name });
        return true;
    }

    async function load(name) {
        const data = await loadWorld(name);
        if (!data) {
            throw new Error(`Unable to load lorebook: ${name}`);
        }
        return data;
    }

    async function save(name, data) {
        await saveWorld(name, data, true);
        logger?.debug('Saved world-info book.', { name });
        return data;
    }

    async function addEntry(name, initializer = {}, { shouldCommit } = {}) {
        if (shouldCommit && !shouldCommit()) return null;
        const data = await load(name);
        if (shouldCommit && !shouldCommit()) return null;
        const entry = createEntry.length === 1
            ? createEntry(data)
            : createEntry(name, data);
        Object.assign(entry, initializer);
        if (shouldCommit && !shouldCommit()) return null;
        await save(name, data);
        return entry;
    }

    async function updateEntry(name, uid, patch, { shouldCommit } = {}) {
        if (shouldCommit && !shouldCommit()) return null;
        const data = await load(name);
        if (shouldCommit && !shouldCommit()) return null;
        const entries = data.entries ?? {};
        const entry = entries[uid] ?? Object.values(entries).find(candidate => candidate?.uid === uid);

        if (!entry) {
            throw new Error(`Lorebook entry ${uid} was not found in ${name}.`);
        }

        if (shouldCommit && !shouldCommit()) return null;
        Object.assign(entry, patch);
        await save(name, data);
        return entry;
    }

    async function removeEntry(name, uid, { shouldCommit } = {}) {
        if (shouldCommit && !shouldCommit()) return false;
        const data = await load(name);
        if (shouldCommit && !shouldCommit()) return false;
        const entries = data.entries ?? {};
        let key = Object.prototype.hasOwnProperty.call(entries, uid) ? uid : null;

        if (key === null) {
            key = Object.keys(entries).find(candidateKey => entries[candidateKey]?.uid === uid) ?? null;
        }

        if (key === null) return false;
        if (shouldCommit && !shouldCommit()) return false;
        delete entries[key];
        await save(name, data);
        return true;
    }

    return Object.freeze({
        create,
        remove,
        load,
        save,
        addEntry,
        updateEntry,
        removeEntry,
    });
}
