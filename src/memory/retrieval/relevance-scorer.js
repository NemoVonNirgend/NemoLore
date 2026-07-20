const TYPE_BONUS = Object.freeze({
    core: 0.35,
    relationship: 0.18,
    'world-state': 0.16,
    entity: 0.14,
    atomic: 0.12,
    episode: 0.1,
    consolidated: 0.08,
});

function tokenize(value) {
    return new Set(String(value ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .split(/\s+/)
        .filter(token => token.length > 2));
}

function overlapScore(left, right) {
    if (!left.size || !right.size) return 0;
    let overlap = 0;
    for (const value of left) if (right.has(value)) overlap += 1;
    return overlap / Math.max(left.size, right.size);
}

function recencyScore(updatedAt, now = Date.now()) {
    const timestamp = Date.parse(updatedAt);
    if (!Number.isFinite(timestamp)) return 0;
    const ageDays = Math.max(0, (now - timestamp) / 86_400_000);
    return 1 / (1 + ageDays / 14);
}

export function createRelevanceScorer({ now = () => Date.now() } = {}) {
    function score(record, query = {}) {
        const queryTerms = tokenize(query.text);
        const recordTerms = tokenize([
            record.title,
            record.content,
            ...record.entityIds,
            ...record.tags,
        ].join(' '));
        const wantedEntities = new Set((query.entityIds ?? []).map(String));
        const wantedTags = new Set((query.tags ?? []).map(String));
        const entityOverlap = record.entityIds.filter(id => wantedEntities.has(id)).length;
        const tagOverlap = record.tags.filter(tag => wantedTags.has(tag)).length;
        const lexical = overlapScore(queryTerms, recordTerms);
        const unresolvedBonus = record.tags.includes('unresolved') || record.data?.unresolvedThreads?.length ? 0.12 : 0;
        const contradictionPenalty = record.metadata?.requiresReview ? 0.08 : 0;

        const components = {
            lexical: lexical * 0.35,
            entity: Math.min(0.28, entityOverlap * 0.14),
            tag: Math.min(0.16, tagOverlap * 0.08),
            importance: record.importance * 0.2,
            confidence: record.confidence * 0.08,
            recency: recencyScore(record.updatedAt, now()) * 0.12,
            type: TYPE_BONUS[record.type] ?? 0,
            unresolved: unresolvedBonus,
            contradictionPenalty: -contradictionPenalty,
        };

        const agingMultiplier = Math.max(0, Math.min(1, Number(record.metadata?.aging?.retrievalMultiplier ?? 1)));
        components.aging = agingMultiplier - 1;
        const subtotal = Object.entries(components)
            .filter(([key]) => key !== 'aging')
            .reduce((sum, [, value]) => sum + value, 0);
        return { record, score: Math.max(0, subtotal * agingMultiplier), components };
    }

    return Object.freeze({ score });
}
