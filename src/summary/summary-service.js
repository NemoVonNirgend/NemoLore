import { SUMMARY_SYSTEM_PROMPT, buildSummaryPrompt } from './summary-prompt.js';
import { createActiveChatGuard } from '../core/active-chat-guard.js';
import { createKeyedLock } from '../core/keyed-lock.js';

export function createSummaryService({ generation, store, settings, logger, getActiveChatId } = {}) {
    if (!generation?.generate) throw new TypeError('Summary service requires generation.');
    if (!store?.save) throw new TypeError('Summary service requires a store.');

    const chatLock = createKeyedLock();

    async function summarizeUnlocked(payload = {}) {
        const chatId = payload.chatId;
        const shouldCommit = createActiveChatGuard(getActiveChatId, chatId);
        if (!shouldCommit()) return { skipped: true, reason: 'chat-changed' };
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
            metadata: { task: 'summary', chatId, engine: 'modular' },
        }, { provider: payload.provider, workflow: 'summary' });

        if (!shouldCommit()) return { skipped: true, reason: 'chat-changed', generation: result };

        const text = String(result.text ?? result).trim();
        const record = await store.save(chatId, {
            text,
            sourceMessageIds: messages.map(message => message.id ?? message.messageId).filter(Boolean),
            sourceRange: payload.sourceRange ?? null,
            paired: payload.paired ?? settings?.enablePairedSummarization,
            metadata: {
                ...(previous?.metadata ?? {}),
                ...(payload.metadata ?? {}),
                engine: 'modular',
                provider: result.provider ?? payload.provider ?? null,
                inputMessageCount: messages.length,
                previousSummaryUpdatedAt: previous?.updatedAt ?? null,
                previousSummarySourceIds: previous?.sourceMessageIds ?? [],
                legacyCompatibility: {
                    paired: payload.paired ?? settings?.enablePairedSummarization,
                    linkSummariesToAI: Boolean(settings?.linkSummariesToAI),
                    showSummariesInChat: Boolean(settings?.showSummariesInChat),
                    hideMessagesWhenThreshold: Boolean(settings?.hideMessagesWhenThreshold),
                },
            },
        });
        logger?.debug('Stored generated summary.', { chatId, messages: messages.length, provider: record.metadata.provider });
        return { skipped: false, record, generation: result };
    }

    async function summarize(payload = {}) {
        const chatId = payload.chatId;
        if (!chatId) throw new TypeError('Summary generation requires chatId.');
        return chatLock.run(`summary:${chatId}`, () => summarizeUnlocked(payload));
    }

    return Object.freeze({ summarize });
}
