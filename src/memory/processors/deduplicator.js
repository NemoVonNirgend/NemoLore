function normalizeText(value) {
    return String(value ?? '')
        .toLowerCase()
        .normalize('NFKC')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenSet(value) {
    return new Set(normalizeText(value).split(' ').filter(Boolean));
}

function jaccardSimilarity(left, right) {
    const a = tokenSet(left);
    const b = tokenSet(right);
    if (!a.size && !b.size) return 1;
    const intersection = [...a].filter(token => b.has(token)).length;
    const union = new Set([...a, ...b]).size;
    return union ? intersection / union : 0;
}

function sameAtomicFact(left, right) {
    if (left.type !== 'atomic' || right.type !== 'atomic') return false;
    const a = left.data ?? {};
    const b = right.data ?? {};
    return normalizeText(a.subject) === normalizeText(b.subject)
        && normalizeText(a.predicate) === normalizeText(b.predicate)
        && normalizeText(a.object) === normalizeText(b.object);
}

function mergeUnique(...collections) {
    return [...new Set(collections.flat().filter(Boolean))];
}

export function createDeduplicator({ similarityThreshold = 0.9, logger } = {}) {
    return async function deduplicate(candidate, { store }) {
        const candidateEntities = candidate.entityIds ?? candidate.entities ?? [];
        const existing = store.query({
            type: candidate.type,
            predicate: record => {
                if (sameAtomicFact(candidate, record)) return true;
                if (candidate.title && record.title
                    && normalizeText(candidate.title) === normalizeText(record.title)
                    && jaccardSimilarity(candidate.content, record.content) >= similarityThreshold) {
                    return true;
                }
                return jaccardSimilarity(candidate.content, record.content) >= similarityThreshold;
            },
        })[0];

        if (!existing) {
            return {
                ...candidate,
                entityIds: mergeUnique(candidateEntities),
            };
        }

        store.update(existing.id, {
            sourceIds: mergeUnique(existing.sourceIds, candidate.sourceIds),
            entityIds: mergeUnique(existing.entityIds, candidateEntities),
            tags: mergeUnique(existing.tags, candidate.tags),
            importance: Math.max(existing.importance, Number(candidate.importance ?? 0)),
            confidence: Math.max(existing.confidence, Number(candidate.confidence ?? 0)),
            metadata: {
                duplicateCount: Number(existing.metadata?.duplicateCount ?? 0) + 1,
                lastDuplicateContent: candidate.content ?? null,
            },
        });

        logger?.debug('Merged duplicate memory candidate.', { existingId: existing.id, type: candidate.type });
        return null;
    };
}

export const memorySimilarity = Object.freeze({ normalizeText, jaccardSimilarity });
