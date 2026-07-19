import { SUMMARY_SYSTEM_PROMPT, buildSummaryPrompt } from './summary-prompt.js';

export function createSummaryService({ generation, store, settings, logger } = {}) {
    if (!generation?.generate) throw new TypeError('Summary service requires generation.');
    if (!store?.save) throw new TypeError('Summary service requires a store.');

    async function summarize(payload = {}) {
        const chatId = payload.chatId;
        if (!chatId) throw new TypeError('Summary generation requires chatId.');
        const previous = store.get(chatId);
        const messages = payload.messages ?? [];
        if (!messages.length) return { skipped: true, reason: 'no-messages' };

        const result = await generation.generate({
            systemPrompt: payload.systemPrompt ?? SUMMARY_SYSTEM_PROMPT,
            prompt: buildSummaryPrompt({
                messages,
                previousSummary: payload.previousSummary ?? previous?.text ?? '',
                maxLength: payload.maxLength ?? settings?.summaryMaxLength ?? 150,
            }),
            maxTokens: payload.maxTokens ?? 500,
            temperature: payload.temperature ?? 0.2,
            metadata: { task: 'summary', chatId },
        }, { provider: payload.provider });

        const text = String(result.text ?? result).trim();
        const record = await store.save(chatId, {
            text,
            sourceMessageIds: messages.map(message => message.id ?? message.messageId).filter(Boolean),
            sourceRange: payload.sourceRange ?? null,
            paired: payload.paired ?? settings?.enablePairedSummarization,
            metadata: { provider: payload.provider ?? null },
        });
        logger?.debug('Stored generated summary.', { chatId, messages: messages.length });
        return { skipped: false, record, generation: result };
    }

    return Object.freeze({ summarize });
}
