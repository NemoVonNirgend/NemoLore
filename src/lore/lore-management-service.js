function entriesFrom(book) {
    return Object.values(book?.entries ?? book ?? {}).filter(value => value && typeof value === 'object');
}

function text(value) {
    return Array.isArray(value) ? value.join(' ') : String(value ?? '');
}

export function createLoreManagementService({ lorebooks, generation, entityIndex, logger } = {}) {
    if (!lorebooks?.load) throw new TypeError('Lore management requires lorebook repository.');

    async function list({ search = '', protectedOnly = false } = {}) {
        const book = await lorebooks.load();
        const query = search.trim().toLowerCase();
        return entriesFrom(book)
            .filter(entry => !protectedOnly || entry.extensions?.nemolore?.protected)
            .filter(entry => !query || [entry.comment, entry.content, text(entry.key)]
                .join(' ')
                .toLowerCase()
                .includes(query))
            .map(entry => ({
                ...structuredClone(entry),
                normalizedIdentities: entityIndex.identitiesFor(entry),
                protected: Boolean(entry.extensions?.nemolore?.protected),
            }));
    }

    async function protect(uid, protectedValue = true) {
        const book = await lorebooks.load();
        const entry = entriesFrom(book).find(item => String(item.uid) === String(uid));
        if (!entry) throw new Error(`Unknown lore entry: ${uid}`);
        return lorebooks.updateEntry(uid, {
            extensions: {
                ...(entry.extensions ?? {}),
                nemolore: {
                    ...(entry.extensions?.nemolore ?? {}),
                    protected: Boolean(protectedValue),
                    protectedAt: new Date().toISOString(),
                },
            },
        });
    }

    async function merge(primaryUid, duplicateUids = []) {
        const book = await lorebooks.load();
        const all = entriesFrom(book);
        const primary = all.find(entry => String(entry.uid) === String(primaryUid));
        if (!primary) throw new Error(`Unknown primary lore entry: ${primaryUid}`);
        const duplicates = all.filter(entry => duplicateUids.map(String).includes(String(entry.uid)));
        const mergedContent = [primary.content, ...duplicates.map(entry => entry.content)]
            .map(value => String(value ?? '').trim())
            .filter(Boolean)
            .filter((value, index, values) => values.indexOf(value) === index)
            .join('\n\n');
        const mergedKeys = [...new Set([
            ...(Array.isArray(primary.key) ? primary.key : [primary.key]),
            ...duplicates.flatMap(entry => Array.isArray(entry.key) ? entry.key : [entry.key]),
        ].filter(Boolean).map(String))];
        const updated = await lorebooks.updateEntry(primaryUid, {
            content: mergedContent,
            key: mergedKeys,
            extensions: {
                ...(primary.extensions ?? {}),
                nemolore: {
                    ...(primary.extensions?.nemolore ?? {}),
                    mergedFrom: duplicateUids.map(String),
                    mergedAt: new Date().toISOString(),
                },
            },
        });
        for (const uid of duplicateUids) await lorebooks.removeEntry(uid);
        logger?.debug('Merged duplicate lore entries.', { primaryUid, duplicateUids });
        return updated;
    }

    function preview(payload) {
        return generation.preview(payload);
    }

    function apply(previewResult, approvedIndexes) {
        return generation.apply(previewResult, { approvedIndexes });
    }

    return Object.freeze({ list, protect, merge, preview, apply });
}
