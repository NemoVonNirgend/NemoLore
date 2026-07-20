function clipped(value, limit = 2_000) {
    return String(value ?? '').trim().slice(0, limit);
}

export function createPreferenceEvidenceCollector({ store, settings, logger } = {}) {
    if (!store?.addEvidence) throw new TypeError('Preference evidence collector requires a preference store.');
    function record(source, input = {}) {
        if (!settings?.enablePreferenceInference) return null;
        const acceptedText = clipped(input.acceptedText);
        const rejectedText = clipped(input.rejectedText);
        if (!acceptedText && !rejectedText) return null;
        if (acceptedText && rejectedText && acceptedText === rejectedText) return null;
        const evidence = store.addEvidence({
            source,
            summary: clipped(input.summary, 500) || `User preference evidence from ${source}.`,
            acceptedText,
            rejectedText,
            chatId: input.chatId,
            messageId: input.messageId,
            metadata: input.metadata,
        });
        logger?.debug('Recorded preference evidence for review.', { source, evidenceId: evidence.id });
        return evidence;
    }
    return Object.freeze({
        recordSwipeChoice: input => record('swipe-choice', input),
        recordEdit: input => record('edit', input),
        recordProblemLine: input => record('problem-line', input),
        recordExplicit: input => record('explicit', input),
    });
}
