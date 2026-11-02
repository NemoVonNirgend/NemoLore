import { createActiveChatGuard } from './active-chat-guard.js';

export function messageText(message) {
    return String(message?.mes ?? message?.content ?? message?.text ?? '');
}

export function messageIdentity(message, index) {
    return String(message?.send_date ?? message?.extra?.id ?? message?.id ?? index);
}

export function messageRevision(message) {
    const text = JSON.stringify([message?.role ?? (message?.is_user ? 'user' : 'assistant'), Boolean(message?.is_system), message?.name ?? '', messageText(message)]);
    let first = 2166136261;
    let second = 5381;
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        first = Math.imul(first ^ code, 16777619);
        second = Math.imul(second, 33) ^ code;
    }
    return `${text.length}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`;
}

/** A chat may stay selected while the source reply is deleted, edited, or swiped. */
export function createHelperSourceGuard({ payload = {}, getContext, getActiveChatId, signal } = {}) {
    const activeChat = createActiveChatGuard(getActiveChatId, payload.chatId);
    const sourceChat = payload.context?.chat;
    const expected = Array.isArray(sourceChat) ? sourceChat.map((message, index) => ({
        index, identity: messageIdentity(message, index), text: messageText(message),
        user: Boolean(message.is_user), system: Boolean(message.is_system), name: message.name,
    })) : [];
    return () => {
        if (signal?.aborted || !activeChat()) return false;
        if (typeof payload.shouldCommit === 'function' && !payload.shouldCommit()) return false;
        if (!expected.length || typeof getContext !== 'function') return true;
        const live = getContext()?.chat;
        return Array.isArray(live) && expected.every(source => {
            const message = live[source.index];
            return message && messageIdentity(message, source.index) === source.identity
                && messageText(message) === source.text
                && Boolean(message.is_user) === source.user
                && Boolean(message.is_system) === source.system
                && message.name === source.name;
        });
    };
}
