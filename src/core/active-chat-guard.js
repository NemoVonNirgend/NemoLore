export function isActiveChat(getActiveChatId, expectedChatId) {
    if (typeof getActiveChatId !== 'function') return true;
    const activeChatId = getActiveChatId();
    if (activeChatId == null || expectedChatId == null) return false;
    return String(activeChatId) === String(expectedChatId);
}

export function createActiveChatGuard(getActiveChatId, expectedChatId) {
    return () => isActiveChat(getActiveChatId, expectedChatId);
}

export class ActiveChatChangedError extends Error {
    constructor(expectedChatId, activeChatId) {
        super(`Active chat changed from ${expectedChatId ?? '<none>'} to ${activeChatId ?? '<none>'}.`);
        this.name = 'ActiveChatChangedError';
        this.code = 'NEMOLORE_ACTIVE_CHAT_CHANGED';
        this.expectedChatId = expectedChatId ?? null;
        this.activeChatId = activeChatId ?? null;
    }
}

export function assertActiveChat(getActiveChatId, expectedChatId) {
    if (isActiveChat(getActiveChatId, expectedChatId)) return expectedChatId;
    throw new ActiveChatChangedError(expectedChatId, getActiveChatId?.());
}

export function isActiveChatChangedError(error) {
    return error?.code === 'NEMOLORE_ACTIVE_CHAT_CHANGED';
}
