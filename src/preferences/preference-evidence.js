const VALID_SOURCES = new Set(['explicit', 'swipe', 'swipe-choice', 'edit', 'problem-line', 'legacy']);

export function createPreferenceEvidence(input, { now = () => new Date().toISOString(), createId } = {}) {
    const source = String(input?.source ?? 'explicit');
    if (!VALID_SOURCES.has(source)) throw new TypeError(`Unknown preference evidence source: ${source}`);
    const summary = String(input?.summary ?? '').trim();
    if (!summary) throw new TypeError('Preference evidence summary is required.');
    return Object.freeze({
        id: input.id ?? createId?.() ?? `evidence-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        source,
        summary,
        acceptedText: String(input.acceptedText ?? '').slice(0, 2_000),
        rejectedText: String(input.rejectedText ?? '').slice(0, 2_000),
        chatId: input.chatId ? String(input.chatId) : null,
        messageId: input.messageId != null ? String(input.messageId) : null,
        createdAt: input.createdAt ?? now(),
        metadata: structuredClone(input.metadata ?? {}),
    });
}
