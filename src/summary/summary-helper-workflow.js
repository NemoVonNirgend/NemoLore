export function createSummaryHelperWorkflow({ summary, inputBuilder, compatibility } = {}) {
    if (!summary?.summarize) throw new TypeError('Summary workflow requires summary service.');

    return async function run(payload = {}) {
        if (compatibility && !compatibility.shouldRunModularSummary()) {
            return { skipped: true, reason: 'summary-engine-mode' };
        }

        const existingMessages = payload.messages ?? payload.context?.messages ?? [];
        const chat = payload.context?.chat ?? existingMessages;
        const built = inputBuilder?.build({
            chat,
            assistantIndex: payload.context?.assistantIndex ?? chat.length - 1,
            previousSummary: payload.previousSummary,
        }) ?? {
            messages: existingMessages,
            sourceRange: payload.sourceRange ?? null,
            paired: payload.paired,
        };

        return summary.summarize({
            ...payload,
            messages: built.messages,
            sourceRange: payload.sourceRange ?? built.sourceRange,
            paired: payload.paired ?? built.paired,
            previousSummary: payload.previousSummary ?? built.previousSummary,
        });
    };
}
