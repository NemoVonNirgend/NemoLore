export function createMemoryRetriever({ selector, scorer, redundancy, budget, composer, semantic, settings, logger } = {}) {
    if (!selector || !scorer || !redundancy || !budget || !composer) {
        throw new TypeError('Memory retriever requires selector, scorer, redundancy, budget, and composer services.');
    }

    async function retrieve(query = {}, options = {}) {
        const candidates = selector.select(query);
        const semanticScores = await semantic?.query?.(query.text, {
            topK: options.vectorSearchLimit ?? settings?.vectorSearchLimit ?? 4,
            threshold: options.vectorSimilarityThreshold ?? settings?.vectorSimilarityThreshold ?? 0.7,
        }) ?? new Map();
        const semanticWeight = Math.max(0, Number(options.semanticWeight ?? 0.35));
        const scored = candidates
            .map(record => {
                const candidate = scorer.score(record, query);
                const semanticScore = semanticScores.get(record.id) ?? 0;
                return {
                    ...candidate,
                    score: candidate.score + (semanticScore * semanticWeight),
                    components: { ...candidate.components, semantic: semanticScore * semanticWeight },
                };
            })
            .filter(candidate => candidate.score >= (options.minScore ?? 0.1))
            .sort((a, b) => b.score - a.score);
        const candidateLimit = Math.max(1, Number(options.candidateLimit ?? scored.length ?? 1));
        const limited = scored.slice(0, candidateLimit);
        const deduplicated = redundancy.filter(limited);
        const allocation = budget.allocate(deduplicated.accepted, options);
        const context = composer.compose(allocation.selected, {
            heading: options.heading,
            includeMetadata: options.includeMetadata,
        });

        const result = {
            ...context,
            selected: allocation.selected,
            omitted: [
                ...deduplicated.rejected.map(candidate => ({ ...candidate, omissionReason: 'redundant' })),
                ...allocation.omitted,
            ],
            candidateCount: candidates.length,
            scoredCount: limited.length,
            eligibleCount: scored.length,
            candidateLimit,
            usedTokens: allocation.usedTokens,
            availableTokens: allocation.availableTokens,
            semanticMatchCount: semanticScores.size,
        };

        logger?.debug('Memory retrieval completed.', {
            candidates: result.candidateCount,
            eligible: result.eligibleCount,
            selected: result.selected.length,
            omitted: result.omitted.length,
            usedTokens: result.usedTokens,
        });

        return result;
    }

    return Object.freeze({ retrieve });
}
