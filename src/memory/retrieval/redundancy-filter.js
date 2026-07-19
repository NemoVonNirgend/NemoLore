function normalize(value) {
    return String(value ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function similarity(left, right) {
    const a = new Set(normalize(left).split(' ').filter(Boolean));
    const b = new Set(normalize(right).split(' ').filter(Boolean));
    if (!a.size || !b.size) return 0;
    let intersection = 0;
    for (const token of a) if (b.has(token)) intersection += 1;
    return intersection / Math.min(a.size, b.size);
}

export function createRedundancyFilter({ threshold = 0.82 } = {}) {
    function filter(scoredRecords) {
        const accepted = [];
        const rejected = [];

        for (const candidate of scoredRecords) {
            const duplicateOf = accepted.find(existing => {
                const sameStructuredFact = candidate.record.type === 'atomic'
                    && existing.record.type === 'atomic'
                    && normalize(candidate.record.data?.subject) === normalize(existing.record.data?.subject)
                    && normalize(candidate.record.data?.predicate) === normalize(existing.record.data?.predicate)
                    && normalize(candidate.record.data?.object) === normalize(existing.record.data?.object);
                return sameStructuredFact || similarity(candidate.record.content, existing.record.content) >= threshold;
            });

            if (duplicateOf) rejected.push({ ...candidate, redundantWith: duplicateOf.record.id });
            else accepted.push(candidate);
        }

        return { accepted, rejected };
    }

    return Object.freeze({ filter });
}
