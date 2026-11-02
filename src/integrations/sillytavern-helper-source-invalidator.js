/** Deletions and replacements invalidate derived context, never schedule new work. */
export function createHelperSourceInvalidator({ runtime, scheduling, persistence, sourceLedger, pipeline, summaryStore, contextBridge } = {}) {
    return async function invalidate({ chatId, firstChangedIndex }) {
        if (!Number.isInteger(firstChangedIndex) || firstChangedIndex < 0) return;
        const cancelled = runtime.invalidate(job => job.metadata?.trigger === 'post-reply'
            && String(job.payload?.chatId) === chatId
            && Number(job.payload?.context?.assistantIndex) >= firstChangedIndex, 'source-changed');
        scheduling.reset(chatId);
        if (String(persistence.activeChatId) !== chatId) return { cancelled };

        const removedIds = new Set();
        const invalidated = new Set();
        for (const source of sourceLedger.list()) {
            if (source.chatId !== chatId || source.messageIndex == null || source.messageIndex < firstChangedIndex) continue;
            removedIds.add(source.messageId);
            for (const id of pipeline.invalidateSource(source.id, 'message-deleted-or-replaced')) invalidated.add(id);
        }
        const summary = summaryStore.get(chatId);
        contextBridge.clear();
        let summaryRemoved = false;
        if (summary && (summary.sourceRange?.end >= firstChangedIndex
            || (summary.sourceMessageIds ?? []).some(id => removedIds.has(String(id))))) {
            summaryRemoved = await summaryStore.remove(chatId);
        }
        if (invalidated.size) await persistence.flush?.();
        return { cancelled, invalidated: [...invalidated], summaryRemoved };
    };
}
