export function createHelperSchedulingPolicy({ settings, clock = Date } = {}) {
    const lastRun = new Map();

    function enabled(workflow) {
        return Boolean({
            memory: settings?.helperMemoryAfterReply,
            summary: settings?.helperSummaryAfterReply,
            lore: settings?.helperLoreAfterReply,
        }[workflow]);
    }

    function minimumMessages(workflow) {
        return Math.max(0, Number({
            memory: settings?.helperMemoryMinMessages ?? 0,
            summary: settings?.helperSummaryMinMessages ?? 4,
            lore: settings?.helperLoreMinMessages ?? 2,
        }[workflow]));
    }

    function cooldownMs(workflow) {
        return Math.max(0, Number({
            memory: settings?.helperMemoryCooldownMs ?? 0,
            summary: settings?.helperSummaryCooldownMs ?? 0,
            lore: settings?.helperLoreCooldownMs ?? 0,
        }[workflow]));
    }

    function hasLoreSignal(payload) {
        if (!settings?.helperLoreRequireSignal) return true;
        if (payload.context?.entities?.length || payload.entityIds?.length) return true;
        const text = String(payload.input ?? '');
        return /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*\b/.test(text)
            || /\b(discovered|revealed|arrived|departed|died|injured|promised|betrayed|joined|left|owns|lost)\b/i.test(text);
    }

    function evaluate(workflow, payload = {}) {
        if (!enabled(workflow)) return { allowed: false, reason: 'disabled' };
        const messageCount = Number(payload.messageCount ?? payload.context?.chatLength ?? 0);
        if (messageCount < minimumMessages(workflow)) return { allowed: false, reason: 'minimum-messages' };
        if (workflow === 'lore' && !hasLoreSignal(payload)) return { allowed: false, reason: 'no-lore-signal' };

        const key = `${workflow}:${payload.chatId ?? 'global'}`;
        const last = lastRun.get(key) ?? 0;
        if (clock.now() - last < cooldownMs(workflow)) return { allowed: false, reason: 'cooldown' };
        return { allowed: true, key };
    }

    function mark(workflow, payload = {}) {
        lastRun.set(`${workflow}:${payload.chatId ?? 'global'}`, clock.now());
    }

    function select(payload = {}) {
        const maximum = Math.max(0, Number(settings?.helperMaxCallsPerReply ?? 3));
        const order = ['memory', 'summary', 'lore'];
        const decisions = order.map(workflow => ({ workflow, ...evaluate(workflow, payload) }));
        const selected = decisions.filter(item => item.allowed).slice(0, maximum);
        for (const item of selected) mark(item.workflow, payload);
        return Object.freeze({ selected, decisions, maximum });
    }

    return Object.freeze({ evaluate, select, reset: () => lastRun.clear() });
}
