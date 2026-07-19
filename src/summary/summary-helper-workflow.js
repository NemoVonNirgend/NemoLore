export function createSummaryHelperWorkflow({ summary }) {
    if (!summary?.summarize) throw new TypeError('Summary workflow requires summary service.');
    return async function run(payload = {}) {
        return summary.summarize({
            ...payload,
            messages: payload.messages ?? payload.context?.messages ?? [],
        });
    };
}
