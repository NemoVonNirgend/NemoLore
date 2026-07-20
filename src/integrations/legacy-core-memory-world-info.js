function isCoreMemoryEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;

    const keys = Array.isArray(entry.key) ? entry.key : [];
    const content = typeof entry.content === 'string' ? entry.content : '';
    return entry.comment === 'Core Memories'
        || keys.includes('core_memories')
        || content.includes('## Core Memories');
}

export function findCoreMemoryEntryUid(worldInfo) {
    const entries = worldInfo?.entries;
    if (!entries || typeof entries !== 'object') return null;

    for (const [uid, entry] of Object.entries(entries)) {
        if (isCoreMemoryEntry(entry)) return uid;
    }

    return null;
}

export function appendCoreMemoryContent(content, memoryText) {
    const current = typeof content === 'string' ? content : '';
    const addition = String(memoryText ?? '');
    const marker = '---\n';
    const markerIndex = current.lastIndexOf(marker);

    if (markerIndex === -1) return current + addition;
    return current.slice(0, markerIndex) + addition + current.slice(markerIndex);
}

export async function writeLegacyCoreMemory({
    lorebookName,
    loadWorldInfo,
    createWorldInfoEntry,
    saveWorldInfo,
    entryTemplate,
    memoryText,
}) {
    if (!lorebookName) {
        throw new Error('No chat lorebook is associated with the current chat.');
    }

    const worldInfo = await loadWorldInfo(lorebookName);
    if (!worldInfo || typeof worldInfo !== 'object') {
        throw new Error(`Could not load lorebook data for: ${lorebookName}`);
    }
    if (!worldInfo.entries || typeof worldInfo.entries !== 'object') {
        worldInfo.entries = {};
    }

    let uid = findCoreMemoryEntryUid(worldInfo);
    let created = false;
    if (uid === null) {
        const createdEntry = createWorldInfoEntry(lorebookName, worldInfo);
        if (!createdEntry || createdEntry.uid === undefined || createdEntry.uid === null) {
            throw new Error('SillyTavern did not create a Core Memories entry.');
        }

        uid = createdEntry.uid;
        const loadedEntry = worldInfo.entries[uid];
        if (!loadedEntry) {
            throw new Error(`Created Core Memories entry ${uid} is missing from loaded lorebook data.`);
        }
        Object.assign(loadedEntry, entryTemplate);
        created = true;
    }

    const entry = worldInfo.entries[uid];
    if (!entry) {
        throw new Error(`Core Memories entry ${uid} is missing from loaded lorebook data.`);
    }
    entry.content = appendCoreMemoryContent(entry.content, memoryText);

    await saveWorldInfo(lorebookName, worldInfo, true);
    return { created, uid, entry, worldInfo };
}
