import { MEMORY_STATUS } from '../memory-types.js';

function normalizeStrings(values = []) {
    return [...new Set(values.map(value => String(value).trim()).filter(Boolean))];
}

export function createCandidateSelector({ store } = {}) {
    if (!store) throw new TypeError('Candidate selector requires a memory store.');

    function select({ entityIds = [], tags = [], types = [], includeCore = true, predicate } = {}) {
        const entities = normalizeStrings(entityIds);
        const wantedTags = normalizeStrings(tags);
        const wantedTypes = normalizeStrings(types);
        const seen = new Set();
        const selected = [];

        function add(records) {
            for (const record of records) {
                if (!record || seen.has(record.id)) continue;
                if (record.status !== MEMORY_STATUS.ACTIVE) continue;
                if (predicate && !predicate(record)) continue;
                seen.add(record.id);
                selected.push(record);
            }
        }

        if (includeCore) add(store.query({ type: 'core' }));
        for (const entityId of entities) add(store.query({ entityId }));
        for (const tag of wantedTags) add(store.query({ tag }));
        for (const type of wantedTypes) add(store.query({ type }));

        if (!entities.length && !wantedTags.length && !wantedTypes.length) {
            add(store.query());
        }

        return selected;
    }

    return Object.freeze({ select });
}
