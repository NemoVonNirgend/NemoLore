function normalizeIdentity(value) {
    return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/[\s_-]+/g, ' ');
}

function entriesFromLorebook(lorebook) {
    if (!lorebook) return [];
    const entries = lorebook.entries ?? lorebook;
    if (Array.isArray(entries)) return entries;
    return Object.entries(entries).map(([uid, entry]) => ({ uid: entry?.uid ?? uid, ...entry }));
}

function identitiesFor(entry) {
    return [entry?.comment, entry?.title, entry?.name,
        ...(Array.isArray(entry?.key) ? entry.key : [entry?.key]),
        ...(Array.isArray(entry?.keys) ? entry.keys : [entry?.keys])]
        .map(normalizeIdentity).filter(Boolean);
}

export function createLoreEntityIndex() {
    function build(lorebook) {
        const byIdentity = new Map();
        for (const entry of entriesFromLorebook(lorebook)) {
            for (const identity of identitiesFor(entry)) {
                if (!byIdentity.has(identity)) byIdentity.set(identity, entry);
            }
        }
        return byIdentity;
    }

    function resolve(lorebook, candidate = {}) {
        const index = build(lorebook);
        const identities = [candidate.key, candidate.title, ...(candidate.keywords ?? [])]
            .map(normalizeIdentity).filter(Boolean);
        for (const identity of identities) {
            const entry = index.get(identity);
            if (entry) return Object.freeze({ identity, entry, uid: entry.uid });
        }
        return null;
    }

    return Object.freeze({ build, resolve, normalizeIdentity, entriesFromLorebook });
}
