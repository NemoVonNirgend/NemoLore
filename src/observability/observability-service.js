function countBy(values, selector) {
    return Object.fromEntries(values.reduce((map, value) => {
        const key = selector(value) ?? 'unknown';
        map.set(key, (map.get(key) ?? 0) + 1);
        return map;
    }, new Map()));
}

function safeClone(value) {
    return value == null ? value : structuredClone(value);
}

export function createObservabilityService({
    contextBridge,
    contextRegistry,
    helperRuntime,
    memoryStore,
    summaryStore,
    lorebooks,
    getChatId,
    logger,
    historyLimit = 100,
} = {}) {
    const history = [];
    const listeners = new Set();
    let panel = null;

    function emit(event) {
        history.push(Object.freeze({
            at: new Date().toISOString(),
            ...safeClone(event),
        }));
        if (history.length > historyLimit) history.splice(0, history.length - historyLimit);
        for (const listener of listeners) {
            try { listener(history.at(-1)); } catch (error) { logger?.error('Observability listener failed.', error); }
        }
    }

    const unsubscribeHelper = helperRuntime?.subscribe?.((event, job) => {
        emit({ type: 'helper-job', event, job });
    }) ?? null;
    const unsubscribeMemory = memoryStore?.subscribe?.((event, record) => {
        emit({ type: 'memory-store', event, recordId: record?.id, memoryType: record?.type });
    }) ?? null;

    function snapshot(chatId = getChatId?.()) {
        const context = contextBridge?.inspect?.() ?? null;
        const jobs = helperRuntime?.list?.() ?? [];
        const memories = memoryStore?.list?.() ?? [];
        const summary = chatId ? summaryStore?.get?.(chatId) ?? null : null;

        return Object.freeze({
            capturedAt: new Date().toISOString(),
            chatId: chatId ? String(chatId) : null,
            context: context ? {
                usedTokens: context.usedTokens ?? 0,
                maxTokens: context.maxTokens ?? 0,
                selectedCount: context.selected?.length ?? 0,
                omittedCount: context.omitted?.length ?? 0,
                errorCount: context.errors?.length ?? 0,
                selected: safeClone(context.selected ?? []),
                omitted: safeClone(context.omitted ?? []),
                errors: safeClone(context.errors ?? []),
                byPosition: safeClone(context.byPosition ?? {}),
                sources: countBy(context.selected ?? [], item => item.source),
            } : null,
            contributors: contextRegistry?.list?.() ?? [],
            memory: {
                total: memories.length,
                byType: countBy(memories, item => item.type),
                byStatus: countBy(memories, item => item.status),
                active: memories.filter(item => item.status === 'active').length,
            },
            summary: safeClone(summary),
            lorebook: lorebooks?.getAssociatedName?.() ?? null,
            helpers: {
                runtime: helperRuntime?.inspect?.() ?? null,
                total: jobs.length,
                byStatus: countBy(jobs, item => item.status),
                jobs: safeClone(jobs),
            },
            recentEvents: safeClone(history),
        });
    }

    function renderText(chatId) {
        const data = snapshot(chatId);
        const context = data.context;
        const lines = [
            '# NemoLore Inspector',
            `Chat: ${data.chatId ?? '(none)'}`,
            `Context: ${context ? `${context.usedTokens}/${context.maxTokens} tokens, ${context.selectedCount} selected, ${context.omittedCount} omitted` : 'not yet built'}`,
            `Memory: ${data.memory.total} total, ${data.memory.active} active`,
            `Summary: ${data.summary?.text ? 'available' : 'none'}`,
            `Lorebook: ${data.lorebook ?? 'none'}`,
            `Helpers: ${data.helpers.runtime?.running ?? 0} running, ${data.helpers.runtime?.queued ?? 0} queued`,
        ];
        return lines.join('\n');
    }

    async function getPanel() {
        if (panel) return panel;
        const { createObservabilityPanel } = await import('../ui/observability-panel.js');
        panel = createObservabilityPanel({ observability: api, logger });
        return panel;
    }

    async function openPanel() {
        return (await getPanel()).open();
    }

    async function closePanel() {
        if (!panel) return false;
        panel.close();
        return true;
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') throw new TypeError('Observability listener must be a function.');
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    function dispose() {
        unsubscribeHelper?.();
        unsubscribeMemory?.();
        panel?.close();
        panel = null;
        listeners.clear();
    }

    const api = Object.freeze({
        snapshot,
        renderText,
        openPanel,
        closePanel,
        subscribe,
        dispose,
        history: () => safeClone(history),
        record: emit,
    });
    return api;
}
