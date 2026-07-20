function messageIndex(args, chat) {
    for (const value of args) {
        const candidate = Number.isInteger(value) ? value : Number.isInteger(value?.messageId) ? value.messageId : value?.index;
        if (Number.isInteger(candidate) && candidate >= 0 && candidate < chat.length) return candidate;
    }
    return chat.length - 1;
}

function selectedText(message) {
    const swipeId = Number(message?.swipe_id ?? 0);
    return String(message?.swipes?.[swipeId] ?? message?.mes ?? '');
}

function snapshot(message) {
    return { text: selectedText(message), swipeId: Number(message?.swipe_id ?? 0) };
}

export function createSillyTavernPreferenceListener({ eventSource, events, getContext, getChatId, collector, logger } = {}) {
    if (!eventSource?.on) throw new TypeError('Preference listener requires an event source.');
    if (typeof getContext !== 'function') throw new TypeError('Preference listener requires getContext().');
    if (!collector?.recordSwipeChoice) throw new TypeError('Preference listener requires an evidence collector.');
    const snapshots = new Map();
    const continuationSignatures = new Set();
    const registrations = [];
    let installed = false;

    function currentChat() { return getContext()?.chat ?? []; }
    function refresh() {
        snapshots.clear();
        continuationSignatures.clear();
        currentChat().forEach((message, index) => { if (!message?.is_user && !message?.is_system) snapshots.set(index, snapshot(message)); });
    }

    function comparison(method, summary, ...args) {
        const chat = currentChat();
        const index = messageIndex(args, chat);
        const message = chat[index];
        if (!message || message.is_user || message.is_system) return null;
        const previous = snapshots.get(index);
        const current = snapshot(message);
        snapshots.set(index, current);
        if (!previous || previous.text === current.text) return null;
        return collector[method]({
            acceptedText: current.text,
            rejectedText: previous.text,
            summary,
            chatId: getChatId?.() ?? getContext()?.chatId,
            messageId: index,
            metadata: { previousSwipeId: previous.swipeId, selectedSwipeId: current.swipeId },
        });
    }

    function onContinuation(...args) {
        const chat = currentChat();
        const userIndex = messageIndex(args, chat);
        for (let index = userIndex - 1; index >= 0; index -= 1) {
            const message = chat[index];
            if (!message || message.is_user || message.is_system) continue;
            snapshots.set(index, snapshot(message));
            if (!Array.isArray(message.swipes) || message.swipes.length < 2) return null;
            const selected = selectedText(message);
            const rejected = message.swipes.filter((_, swipeIndex) => swipeIndex !== Number(message.swipe_id ?? 0)).join('\n\n--- alternate swipe ---\n\n');
            const signature = `${getChatId?.()}:${index}:${message.swipe_id}:${message.swipes.length}`;
            if (continuationSignatures.has(signature)) return null;
            continuationSignatures.add(signature);
            return collector.recordSwipeChoice({
                acceptedText: selected,
                rejectedText: rejected,
                summary: 'The user continued from one swipe instead of its alternatives.',
                chatId: getChatId?.() ?? getContext()?.chatId,
                messageId: index,
                metadata: { selectedSwipeId: Number(message.swipe_id ?? 0), alternativeCount: message.swipes.length - 1 },
            });
        }
        return null;
    }

    function register(name, handler) {
        if (!name) return;
        eventSource.on(name, handler);
        registrations.push([name, handler]);
    }

    function install() {
        if (installed) return false;
        register(events?.chatChanged, refresh);
        register(events?.chatLoaded, refresh);
        register(events?.messageSwiped, (...args) => comparison('recordSwipeChoice', 'The user selected a different assistant swipe.', ...args));
        register(events?.messageEdited, (...args) => comparison('recordEdit', 'The user edited an assistant response.', ...args));
        register(events?.userMessageRendered, onContinuation);
        refresh();
        installed = true;
        return true;
    }

    function uninstall() {
        for (const [name, handler] of registrations.splice(0)) {
            eventSource.removeListener?.(name, handler);
            eventSource.off?.(name, handler);
        }
        installed = false;
        snapshots.clear();
        continuationSignatures.clear();
    }

    return Object.freeze({ install, uninstall, refresh, onContinuation, get installed() { return installed; } });
}
