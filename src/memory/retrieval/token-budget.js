function defaultEstimate(text) {
    return Math.ceil(String(text ?? '').length / 4);
}

export function createTokenBudget({ estimateTokens = defaultEstimate } = {}) {
    function allocate(scoredRecords, { maxTokens = 1200, reserveTokens = 0 } = {}) {
        const available = Math.max(0, maxTokens - reserveTokens);
        const selected = [];
        const omitted = [];
        let usedTokens = 0;

        for (const candidate of scoredRecords) {
            const text = candidate.record.content || JSON.stringify(candidate.record.data ?? {});
            const estimatedTokens = Math.max(1, estimateTokens(text));
            if (usedTokens + estimatedTokens <= available) {
                selected.push({ ...candidate, estimatedTokens });
                usedTokens += estimatedTokens;
            } else {
                omitted.push({ ...candidate, estimatedTokens, omissionReason: 'token-budget' });
            }
        }

        return { selected, omitted, usedTokens, availableTokens: available };
    }

    return Object.freeze({ allocate });
}
